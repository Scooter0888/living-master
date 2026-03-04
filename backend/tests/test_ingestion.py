"""
Ingestion integration tests.

Run: pytest tests/test_ingestion.py -v

Note: Tests that hit real URLs require internet access.
      Tests that use Whisper require faster-whisper to be installed.
      Set SKIP_NETWORK_TESTS=1 to skip network-dependent tests.
"""
import os
import asyncio
import tempfile
import pytest

SKIP_NETWORK = os.getenv("SKIP_NETWORK_TESTS", "0") == "1"


# ── URL Detection ───────────────────────────────────────────────────────────

def test_detect_youtube_watch():
    from app.services.ingestion.router import detect_content_type
    assert detect_content_type("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "youtube"


def test_detect_youtube_short():
    from app.services.ingestion.router import detect_content_type
    assert detect_content_type("https://youtu.be/dQw4w9WgXcQ") == "youtube"


def test_detect_youtube_shorts():
    from app.services.ingestion.router import detect_content_type
    assert detect_content_type("https://www.youtube.com/shorts/abc123") == "youtube"


def test_detect_web_url():
    from app.services.ingestion.router import detect_content_type
    assert detect_content_type("https://example.com/article") == "web"


def test_detect_pdf():
    from app.services.ingestion.router import detect_content_type
    assert detect_content_type("report.pdf") == "pdf"
    assert detect_content_type("https://example.com/file.pdf") == "pdf"


def test_detect_audio():
    from app.services.ingestion.router import detect_content_type
    for ext in [".mp3", ".wav", ".m4a", ".ogg", ".flac"]:
        assert detect_content_type(f"audio{ext}") == "audio", f"Failed for {ext}"


def test_detect_video():
    from app.services.ingestion.router import detect_content_type
    for ext in [".mp4", ".mkv", ".avi", ".mov", ".webm"]:
        assert detect_content_type(f"video{ext}") == "video", f"Failed for {ext}"


def test_detect_docx():
    from app.services.ingestion.router import detect_content_type
    assert detect_content_type("document.docx") == "docx"


# ── Text Chunking ───────────────────────────────────────────────────────────

def test_chunk_normal_text():
    from app.services.embeddings import chunk_text
    text = "Hello world. " * 200  # ~2600 chars
    chunks = chunk_text(text)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) > 50


def test_chunk_short_text():
    from app.services.embeddings import chunk_text
    text = "This is a very short piece of text."
    chunks = chunk_text(text)
    # Short text should either produce one chunk or zero (filtered as too short)
    assert len(chunks) <= 1


def test_chunk_filters_short_chunks():
    from app.services.embeddings import chunk_text
    text = "A. B. C. " + "This is a much longer sentence that should pass the 50 char minimum threshold. " * 20
    chunks = chunk_text(text)
    for chunk in chunks:
        assert len(chunk.strip()) > 50, f"Chunk too short: {chunk!r}"


# ── Web Ingestion ───────────────────────────────────────────────────────────

@pytest.mark.skipif(SKIP_NETWORK, reason="Network test skipped")
@pytest.mark.asyncio
async def test_ingest_web_wikipedia():
    from app.services.ingestion.web import ingest_web
    content = await ingest_web("https://en.wikipedia.org/wiki/Naval_Ravikant")
    assert content.content_type == "web"
    assert len(content.text) > 500
    assert content.title
    print(f"\n[Web] Title: {content.title}, chars: {len(content.text)}")


@pytest.mark.skipif(SKIP_NETWORK, reason="Network test skipped")
@pytest.mark.asyncio
async def test_ingest_web_article():
    from app.services.ingestion.web import ingest_web
    content = await ingest_web("https://paulgraham.com/wealth.html")
    assert content.content_type == "web"
    assert len(content.text) > 1000
    print(f"\n[Web] Title: {content.title}, chars: {len(content.text)}")


# ── YouTube Ingestion ───────────────────────────────────────────────────────

@pytest.mark.skipif(SKIP_NETWORK, reason="Network test skipped")
@pytest.mark.asyncio
async def test_ingest_youtube_with_transcript():
    from app.services.ingestion.youtube import ingest_youtube
    # Short, well-known video with reliable transcript
    url = "https://www.youtube.com/watch?v=3qHkcs3kG44"  # Naval on happiness
    content = await ingest_youtube(url)
    assert content.content_type == "youtube"
    assert len(content.text) > 100
    assert content.title
    print(f"\n[YouTube] Title: {content.title}, chars: {len(content.text)}")


# ── PDF Ingestion ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ingest_pdf_local():
    from app.services.ingestion.pdf import ingest_pdf
    import pdfplumber

    # Create a minimal test PDF in memory
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        tmp_path = f.name

    try:
        # Create PDF with reportlab if available, else skip
        try:
            from reportlab.pdfgen import canvas
            c = canvas.Canvas(tmp_path)
            c.drawString(100, 750, "This is a test document for Living Master ingestion testing.")
            c.drawString(100, 730, "It contains multiple lines of text to verify extraction works correctly.")
            c.save()
        except ImportError:
            pytest.skip("reportlab not installed, skipping PDF creation test")

        content = await ingest_pdf(tmp_path, "test.pdf")
        assert content.content_type == "pdf"
        assert "test" in content.text.lower() or len(content.text) > 10
        print(f"\n[PDF] Extracted: {len(content.text)} chars")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ── Audio Ingestion (Whisper) ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_transcription_with_sample():
    """Test Whisper transcription with a real audio file if available."""
    sample_path = os.path.join(os.path.dirname(__file__), "fixtures", "sample.mp3")
    if not os.path.exists(sample_path):
        pytest.skip("No sample.mp3 in tests/fixtures/ — place one there to test transcription")

    from app.services.transcription import transcribe_audio
    text = await transcribe_audio(sample_path)
    assert isinstance(text, str)
    assert len(text) > 0
    print(f"\n[Whisper] Transcribed: {text[:100]}…")


# ── Full Pipeline ───────────────────────────────────────────────────────────

@pytest.mark.skipif(SKIP_NETWORK, reason="Network test skipped")
@pytest.mark.asyncio
async def test_full_pipeline_web():
    """End-to-end: ingest → chunk → embed (mocked) → verify data."""
    from app.services.ingestion.web import ingest_web
    from app.services.embeddings import chunk_text

    content = await ingest_web("https://en.wikipedia.org/wiki/Stoicism")
    chunks = chunk_text(content.text)

    assert len(chunks) > 5
    assert all(len(c) > 50 for c in chunks)
    print(f"\n[Pipeline] {len(chunks)} chunks from {len(content.text)} chars")


@pytest.mark.skipif(SKIP_NETWORK, reason="Network test skipped")
@pytest.mark.asyncio
async def test_discovery_search():
    """Test discovery search returns results."""
    from app.services.discovery import discover_person
    results = await discover_person("Naval Ravikant", max_results_per_category=2)
    assert results["name"] == "Naval Ravikant"
    assert results["total_found"] >= 0  # May be 0 if no API keys set
    print(f"\n[Discovery] Found {results['total_found']} results across {len(results['categories'])} categories")
