const puppeteer = require('puppeteer-core');
const { exec } = require('child_process');
const util = require('util')

const CYCLE_INTERVAL = 3000;
const TIMEOUT_FOR_IDLE = 15000;

async function getStreamClients() {
    try {
        const response = await fetch('http://10.10.10.10:1985/api/v1/streams/');
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        const clients = data?.streams?.[0]?.clients;

        return clients ?? 0;
    } catch (error) {
        console.error('Failed to fetch SRS stream clients:', error.message);
        return 0;
    }
}

async function writeCameraStatus(status, noDemand = false) {
    const e = execAsync(`echo "Състояние на камерата: ${status}${noDemand ? '\nБез зрители в последните 15 секунди, изчакайте за свързване...' : ''}" > devstate.tmp && mv devstate.tmp devstate`)
    const se = (await e.catch(e => e)).stderr
    if (!!se) console.error("Error when writing camera status: " + se)
}

class ReolinkMonitor {
    #browserPort;
    #browser;
    state;
    mainPage;

    constructor(port = 9222) {
        this.#browserPort = port;
        this.state = {
            camera: {
                status: 'Unknown',
                canRetry: true,
            },
            isInFullScreen: false,
            streamClients: 0,
            noDemandCycles: Math.ceil(TIMEOUT_FOR_IDLE / CYCLE_INTERVAL),
            isPlaying: false,
        }
    }

    #hasDemand() {
        return this.state.noDemandCycles * CYCLE_INTERVAL < TIMEOUT_FOR_IDLE;
    }

    async init() {
        this.#browser = await puppeteer.connect({
            browserURL: `http://localhost:${this.#browserPort}`,
            defaultViewport: null
        });
        this.mainPage = (await this.#browser.pages())[0]

        // Intercept battery saver dialog
        this.#browser.on('targetcreated', async (target) => {
            if (target.type() === 'page') {
                const newPage = await target.page();
                console.log(`New Window Detected!`);
                try {
                    const el = await newPage.waitForSelector('reo-button[children="Cancel"]')
                    const btn = await el.$('button')
                    await btn.click();
                    console.log('Clicked "Cancel".')
                }
                catch (e) {
                    console.log('Failed to deal with dialog.')
                }
            }
        });
    }

    async monitorLoop() {
        while (true) {
            try {
                await this.updateState()
                const hasDemand = this.#hasDemand()
                await writeCameraStatus(this.state.camera.status, !hasDemand);
                if(this.state.camera.status === 'Connected') {
                    if (!hasDemand && this.state.isPlaying) {
                        await this.disconnectDevice();
                    }
                    if (!this.state.isInFullScreen && this.state.isPlaying) await this.enterFullscreen()
                }
                else if(this.state.camera.canRetry && hasDemand) {
                    if(!this.state.isPlaying) {
                        console.log('Retry allowed. Trying to connect...')
                        if(this.state.isInFullScreen) await this.exitFullscreen()
                        await this.clickDevice()
                    }
                }
                else if(!hasDemand) {}
                else {
                    console.log('Unrecoverable camera state:', this.state.camera.status)
                }
            }
            catch (e) {
                console.error(`Monitor loop step failed: ${e.message}\n${e.stack}`);
            }
            await sleep(CYCLE_INTERVAL)
        }
    }

    async updateState() {
        const [liveToolBar, deviceElement] = await Promise.all([this.mainPage.$('.tool-bar.live'), this.mainPage.$('.device-list-item')])
        // this.state.isInFullScreen = await liveBar.evaluate(el => el.style.display === 'none')
        this.state.camera = await deviceElement.evaluate(el => {
            const notice = el.querySelector('.device-notice')
            const settimgs = el.querySelector('.device-settings')
            const canRetry = settimgs.querySelector('div[title="Retry"]').parentElement.style.display !== 'none';
            const text = el.querySelector('.state-text').textContent
            return { status: text, canRetry }
        })
        this.state.isPlaying = await liveToolBar.evaluate(el => {
            return el.style.display !== 'none' && !!el.querySelector('.video-stop-btn')
        })
        this.state.streamClients = await getStreamClients();
        if (this.state.streamClients < 2) this.state.noDemandCycles++
        else this.state.noDemandCycles = 0
        console.log(this.state);
    }

    async enterFullscreen(){
        const fscr = await this.mainPage.evaluate(() => {
            const items = document.querySelectorAll('#live_tab li.btn-cell div');
            for (const div of items) {
                if (div.getAttribute('title') === 'Full Screen') {
                    try {
                        div.click();
                    }
                    catch (e) {
                        return false;
                    }
                    return true;
                }
            }
            return false;
        });

        if(!fscr) {
            console.warn('Failed to enter fullscreen.');
            return false;
        }

        console.log('Entered fullscreen.');
        this.state.isInFullScreen = true;
        return true;
    }

    async exitFullscreen(){
        console.log('Exiting fullscreen with ESCAPE...');
        await this.mainPage.focus('body');
        const sp = execAsync('DISPLAY=:99 xdotool key Escape')
        const { stdout, stderr } = await sp.catch(e => e)
        if(stdout) console.log('xdotool stdout:', stdout)
        if(stderr) console.error('xdotool stderr:', stderr)
        this.state.isInFullScreen = false;
    }

    async clickDevice() {
        const deviceElement = await this.mainPage.waitForSelector('.device-list-item')
        await deviceElement.click();
        console.log('Device clicked.');

    }

    async [Symbol.asyncDispose]() {
        if (this.#browser)
            this.#browser.disconnect();
    }

    async disconnectDevice() {
        const el = await this.mainPage.waitForSelector('.video-stop-btn')
        await el.click();
        console.log('Clicked stop video.')
    }
}

const execAsync = util.promisify(exec);

function sleep(ms) {
    return new Promise((resolve, reject) => setTimeout(resolve, ms))
}

(async () => {
    await using monitor = new ReolinkMonitor(9223);
    await monitor.init();
    await monitor.monitorLoop();
})();
