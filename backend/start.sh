#!/bin/bash
# Auto-restarting backend launcher.
# - No --reload flag: prevents uvicorn from reloading mid-ingestion when files change
# - Loop: automatically restarts if the server crashes or hangs and gets killed
# Usage: bash start.sh

cd "$(dirname "$0")"

while true; do
    echo "[$(date)] Starting backend..."
    /opt/anaconda3/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
    echo "[$(date)] Backend exited with code $?. Restarting in 3 seconds..."
    sleep 3
done
