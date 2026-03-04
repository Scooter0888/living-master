#!/bin/bash

echo ""
echo "╔═══════════════════════════════════╗"
echo "║        Living Master              ║"
echo "╚═══════════════════════════════════╝"
echo ""

# Check for .env
if [ ! -f "backend/.env" ]; then
  echo "⚠  No .env file found. Copying from .env.example..."
  cp backend/.env.example backend/.env
  echo "📝 Edit backend/.env with your API keys before starting."
  echo ""
fi

# Kill anything already on ports 8000 and 3000
lsof -ti:8000,3000 | xargs kill -9 2>/dev/null || true
sleep 1

# Start backend using system anaconda Python (has all packages)
echo "▶ Starting backend (FastAPI)..."
cd backend
/opt/anaconda3/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd ..

# Wait for backend to be ready
echo "  Waiting for backend..."
for i in {1..30}; do
  if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "  ✓ Backend ready"
    break
  fi
  sleep 1
done

# Build and start frontend in production mode (no compile-on-first-request delay)
echo "▶ Building frontend (Next.js)..."
cd frontend
if [ ! -d "node_modules" ]; then
  echo "  Installing dependencies..."
  npm install
fi
npm run build
if [ $? -ne 0 ]; then
  echo "  ✗ Build failed. Check output above."
  kill $BACKEND_PID 2>/dev/null
  exit 1
fi
echo "  ✓ Build complete. Starting server..."
npm start -- --port 3000 &
FRONTEND_PID=$!
cd ..

# Wait for frontend to be ready
echo "  Waiting for frontend..."
for i in {1..30}; do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "  ✓ Frontend ready"
    break
  fi
  sleep 1
done

echo ""
echo "✓ Living Master is running!"
echo ""
echo "  Frontend:  http://localhost:3000"
echo "  Backend:   http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop."
echo ""

# Wait and handle shutdown
trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
