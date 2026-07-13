const puppeteer = require('puppeteer-core');
const { exec } = require('child_process');
const util = require('util')
const fs = require('fs')
const { open } = require('fs/promises')
const constants = require("node:constants");

const execAsync = util.promisify(exec);

function sleep(ms) {
    return new Promise((resolve, reject) => setTimeout(resolve, ms))
}

async function reconnectLoop(deviceElement, page = null) {
    while (true) {
        let status = await deviceElement.evaluate(el => {
            const notice = el.querySelector('.device-notice')
            const settimgs = el.querySelector('.device-settings')
            const canRetry = settimgs.querySelector('div[title="Retry"]').parentElement.style.display !== 'none';
            const text = el.querySelector('.state-text').textContent
            return [text, canRetry]
        })
        console.log('Device state:', status);
        //const fd = await open('devstate', constants.O_WRONLY | constants.O_NONBLOCK)
        //fs.writeSync(fd, 'Camera status: ' + status[0], null, 'utf8');
	const e = execAsync(`echo "Camera status: ${status[0]}" > devstate.tmp && mv devstate.tmp devstate`)
	const se = (await e.catch(e => e)).stderr
	if (!!se) console.error("Error when writing camera status: " + se)
        if (status[0] === 'Connected') break
        else if (status[1]) {
            try {
                await deviceElement.click();
                console.log('Device clicked');
            }
            catch (e) {
                if (e.message === 'Node is either not clickable or not an Element') {
                    console.log('Esc')
                    await page.focus('body');
                    const sp = execAsync('DISPLAY=:99 xdotool key Escape')
                    const { stdout, stderr } = await sp.catch(e => e)
                    console.log('xdotool stdout:', stdout)
                    console.error('xdotool stderr:', stderr)
                    await deviceElement.click();
                    console.log('Device clicked');
                    await enterFullscreen(page);
                }
                else {
                    console.error(e)
                }
            }
        }
        await sleep(1000);
    }
}

async function enterFullscreen(page) {
    await page.waitForSelector('#live_tab');

    const fscr = await page.evaluate(() => {
        const items = document.querySelectorAll('#live_tab li.btn-cell div');
        for (const div of items) {
            if (div.getAttribute('title') === 'Full Screen') {
                div.click();
                return true;
            }
        }
        return false;
    });

    await sleep(500);


    if (fscr) {
        console.log('Entered fullscreen!')
        let res = await page.$('.bottom-prompt')
        if(res) {
            // Hide popup
            const hide = await res.evaluate(el => {
                if (el.textContent === 'Press Esc to exit full screen.') {
                    el.setAttribute('style', 'display:none');
                    return true;
                }
                return false;
            })

            if (hide) {
                console.log('Hid hint!')
            }
        }
    }
    else {
        console.log('Failed to enter fullscreen!')
    }
}

const run = async () => {
    const browser = await puppeteer.connect({
        browserURL: 'http://localhost:9223',
        defaultViewport: null
    });
    // 1. Set up a listener for any new window targets opening
    browser.on('targetcreated', async (target) => {
        // Only intercept if the target type is a page/window
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

    const pages = await browser.pages();
    const page = pages[0];


    // Activate camera
    let device = await page.waitForSelector('.device-list-item')

    await reconnectLoop(device, page);

    await sleep(1000);

    await enterFullscreen(page);

    // Activate camera
    // device = await page.waitForSelector('.device-list-item')
    while (true) {
        await reconnectLoop(device, page);
        await sleep(5000);
    }

    await browser.disconnect();

}

(async () => {
    while (true) {
        try {

            await run();
        }
        catch (e) {
            console.error(e.message);
            console.error(e.stack);
        }
    }
})();
