#!/bin/bash

./kill.sh
# Define the target display context
export DISPLAY=:99
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"

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

systemctl --user start livestream.service
