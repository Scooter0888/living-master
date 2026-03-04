"""
Content-type detection and routing to the correct ingestion service.
"""
import os
import re
from typing import Optional

from app.services.ingestion.base import IngestedContent


YOUTUBE_PATTERN = re.compile(
    r"(youtube\.com/watch|youtu\.be/|youtube\.com/shorts|youtube\.com/embed)"
)

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".weba"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".vob"}
PDF_EXTENSION = ".pdf"
DOCX_EXTENSION = ".docx"
ISO_EXTENSION = ".iso"


def detect_content_type(url_or_path: str) -> str:
    lower = url_or_path.lower()
    if YOUTUBE_PATTERN.search(lower):
        return "youtube"
    ext = os.path.splitext(lower)[1]
    if ext in AUDIO_EXTENSIONS:
        return "audio"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext == PDF_EXTENSION:
        return "pdf"
    if ext == DOCX_EXTENSION:
        return "docx"
    if ext == ISO_EXTENSION:
        return "iso"
    if lower.startswith("http://") or lower.startswith("https://"):
        return "web"
    return "text"


async def ingest_url(url: str) -> IngestedContent:
    content_type = detect_content_type(url)

    if content_type == "youtube":
        from app.services.ingestion.youtube import ingest_youtube
        return await ingest_youtube(url)

    if content_type == "web":
        from app.services.ingestion.web import ingest_web
        return await ingest_web(url)

    raise ValueError(f"Cannot ingest URL with content type '{content_type}'. Use file upload instead.")


async def ingest_file(file_path: str, original_filename: str) -> IngestedContent:
    content_type = detect_content_type(original_filename)

    if content_type == "audio":
        from app.services.ingestion.audio import ingest_audio
        return await ingest_audio(file_path, original_filename)

    if content_type == "video":
        from app.services.ingestion.video import ingest_video
        return await ingest_video(file_path, original_filename)

    if content_type == "pdf":
        from app.services.ingestion.pdf import ingest_pdf
        return await ingest_pdf(file_path, original_filename)

    if content_type == "docx":
        from app.services.ingestion.pdf import ingest_docx
        return await ingest_docx(file_path, original_filename)

    if content_type == "iso":
        from app.services.ingestion.iso import ingest_iso
        return await ingest_iso(file_path, original_filename)

    raise ValueError(f"Unsupported file type: {original_filename}")
