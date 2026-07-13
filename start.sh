#!/bin/bash

./kill.sh
# Define the target display context
export DISPLAY=:99

echo "Starting Xvfb on display ${DISPLAY}..."
Xvfb :99 -screen 0 1920x1080x24 &
sleep 2

echo "Starting Openbox..." 
openbox-session &
sleep 2

echo "Starting x11vnc server..."
x11vnc -display :99 -forever -listen 10.10.10.11 -shared -nopw -bg &
sleep 2

echo "Launching Reolink..."
WINEDLLOVERRIDES="d3d11=b;d3d10core=b;dxgi=b;vulkan-1=d" \
wine "C:\\Program Files\\Reolink\\Reolink.exe" \
  --no-sandbox \
  --disable-gpu \
  --disable-software-rasterizer \
  --remote-debugging-port=9223 \
  >> /tmp/electron.log 2>&1 &

echo "Waiting 10 seconds for the application interface to settle..."
sleep 10

echo "Starting UI Automation..."
NODE_PATH=$(npm root -g) node ./automation.js > /tmp/automation.log 2>&1 &

echo "Starting FFmpeg stream to SRS gateway..."
ffmpeg -f x11grab \
  -video_size 1920x1080 \
  -framerate 25 \
  -i :99.0 \
  -c:v libx264 \
  -preset ultrafast \
  -tune zerolatency \
  -vf "drawtext=x=30:y=30:fontsize=20:fontcolor=white:reload=25:fontfile=/usr/share/fonts/noto/NotoSansMono-Bold.ttf:textfile=devstate" \
  -pix_fmt yuv420p \
  -f flv \
  rtmp://10.10.10.10/live/livestream > /tmp/ffmpeg.log 2>&1 &
