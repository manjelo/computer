#!/usr/bin/env bash
# Starts the booth app and opens it fullscreen. Press Alt+F4 to close the window,
# then Ctrl+C here to stop the server.
set -u
cd "$(dirname "$0")"

URL="http://127.0.0.1:8000/"
echo "Preparing the AI model, this takes about 15 seconds..."
.venv/bin/python -m uvicorn server:build_app --factory --host 127.0.0.1 --port 8000 \
    --log-level warning --timeout-graceful-shutdown 1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT

until curl -sf -o /dev/null "$URL"; do
    kill -0 "$SERVER" 2>/dev/null || { echo "The server failed to start."; exit 1; }
    sleep 0.5
done
echo "Ready at $URL"

for browser in google-chrome chromium chromium-browser; do
    if command -v "$browser" >/dev/null; then
        "$browser" --kiosk --app="$URL" --user-data-dir="$PWD/.browser-profile" \
            --no-first-run >/dev/null 2>&1 &
        wait "$SERVER"
        exit
    fi
done

if command -v firefox >/dev/null; then
    firefox --kiosk "$URL" >/dev/null 2>&1 &
else
    echo "No browser found. Open $URL and press F11."
fi
wait "$SERVER"
