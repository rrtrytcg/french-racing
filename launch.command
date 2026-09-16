#!/bin/sh
# APEX one-click launcher (macOS): double-click to start the game server and
# open the race setup in the default browser. Keep this window open; press
# Enter to stop the server.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "APEX needs Node.js (current LTS) to run."
  echo "Install it free from https://nodejs.org/ then double-click this file again."
  echo ""
  echo "Press Enter to close."
  read -r _
  exit 1
fi
node serve.mjs --open &
SERVER_PID=$!
echo "APEX is running at http://127.0.0.1:4178/"
echo "Keep this window open while you race."
echo "Press Enter to stop the server and close."
read -r _
kill "$SERVER_PID" 2>/dev/null
