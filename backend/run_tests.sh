#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt -q
pip install pytest pytest-asyncio httpx -q

echo ""
echo "Running tests..."
echo ""

# Run unit tests first (no network needed)
SKIP_NETWORK_TESTS=1 python -m pytest tests/ -v --tb=short

echo ""
echo "Run with SKIP_NETWORK_TESTS=0 to include live network tests."
