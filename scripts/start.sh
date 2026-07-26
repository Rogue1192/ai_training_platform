#!/usr/bin/env bash
set -e

# ── Virtual Display Stack ────────────────────────────────────────────────────
# Start Xvfb on display :99 (1920x1080, 24-bit color)
# This is the "default" display used by the app itself.
# Per-profile login sessions will each get their own display (:10 through :59).
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
export DISPLAY=:99

# Give Xvfb a moment to initialize
sleep 1
echo "[start.sh] Xvfb started on DISPLAY=:99 (PID $XVFB_PID)"

# ── x11vnc (default display) ─────────────────────────────────────────────────
# Per-profile login sessions spawn their own x11vnc on dedicated ports.
x11vnc \
  -display :99 \
  -rfbport 5999 \
  -nopw \
  -shared \
  -forever \
  -quiet \
  -bg \
  -o /tmp/x11vnc.log 2>/dev/null || true
echo "[start.sh] x11vnc started on port 5999 (default display)"

# ── noVNC static files path ───────────────────────────────────────────────────
# In Nix, novnc installs to /nix/store/…/share/novnc — find it dynamically.
NOVNC_WEB=""
for candidate in \
  /usr/share/novnc \
  /usr/share/webapps/novnc \
  /nix/store/*/share/novnc; do
  if [ -f "$candidate/vnc.html" ] || [ -f "$candidate/vnc_lite.html" ]; then
    NOVNC_WEB="$candidate"
    break
  fi
done

if [ -z "$NOVNC_WEB" ]; then
  echo "[start.sh] WARNING: noVNC static files not found — login panel will use websockify only"
  NOVNC_WEB="/usr/share/novnc"
else
  echo "[start.sh] noVNC static files found at: $NOVNC_WEB"
fi

export NOVNC_WEB_DIR="$NOVNC_WEB"

# ── Application ──────────────────────────────────────────────────────────────
echo "[start.sh] Starting AI Answer Forge application..."
exec pnpm start
