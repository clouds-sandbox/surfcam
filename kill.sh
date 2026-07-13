systemctl --user stop livestream
pkill -9 -f "node"
pkill -9 -f "Reolink.exe"
pkill -9 -f "wine"
pkill -9 -f "Xvfb"
pkill -9 -f "x11vnc"
pkill -9 -f "openbox"
wineserver -k
