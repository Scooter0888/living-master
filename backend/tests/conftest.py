import pytest
import pytest_asyncio
import asyncio
import os

# Point to in-memory DB for tests
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("SERPER_API_KEY", "test-key")
os.environ.setdefault("YOUTUBE_API_KEY", "test-key")


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
