#!/bin/bash
set -e

echo ""
echo "╔═══════════════════════════════════╗"
echo "║        Living Master              ║"
echo "╚═══════════════════════════════════╝"
echo ""

# Check for .env
if [ ! -f "backend/.env" ]; then
  cp backend/.env.example backend/.env
fi

# Kill anything already on ports 8000 and 3000
lsof -ti:8000,3000 | xargs kill -9 2>/dev/null || true
sleep 2

# ── Backend ──────────────────────────────────────
echo "▶ Starting backend..."
cd backend
/opt/anaconda3/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /tmp/lm_backend.log 2>&1 &
BACKEND_PID=$!
cd ..

for i in {1..30}; do
  if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "  ✓ Backend ready (http://localhost:8000)"
    break
  fi
  sleep 1
done

# ── Frontend ─────────────────────────────────────
echo "▶ Starting frontend (dev mode)..."
cd frontend

if [ ! -d "node_modules" ]; then
  npm install
fi

# Use PORT env var — most reliable way to set port in Next.js dev
PORT=3000 node_modules/.bin/next dev -p 3000 > /tmp/lm_frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

echo "  Waiting for frontend (first compile takes ~30s)..."
for i in {1..90}; do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "  ✓ Frontend ready (http://localhost:3000)"
    break
  fi
  sleep 1
  if [ $i -eq 90 ]; then
    echo "  ✗ Frontend timed out. Check /tmp/lm_frontend.log"
    echo "  Last log:"
    tail -10 /tmp/lm_frontend.log
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓  http://localhost:3000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop."
echo ""

trap "echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
