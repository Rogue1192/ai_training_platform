#!/usr/bin/env bash
set -e

# ── Browser Display ──────────────────────────────────────────────────────────
# CloakBrowser's retained V7 worker runs headed and requires an X display.
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
export DISPLAY=:99

# Give Xvfb a moment to initialize
sleep 1
echo "[start.sh] Xvfb started on DISPLAY=:99 (PID $XVFB_PID)"

# ── Application ──────────────────────────────────────────────────────────────
echo "[start.sh] Starting AI Answer Forge application..."
exec pnpm start
