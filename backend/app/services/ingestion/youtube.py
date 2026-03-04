"""
YouTube ingestion: tries multiple transcript strategies before falling back to Whisper.
Requires ffmpeg for Whisper fallback — if not present, raises a clear error.
"""
import re
import asyncio
import shutil
from typing import Optional

from app.services.ingestion.base import IngestedContent


def _extract_video_id(url: str) -> Optional[str]:
    patterns = [
        r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


async def ingest_youtube(url: str) -> IngestedContent:
    video_id = _extract_video_id(url)
    if not video_id:
        raise ValueError(f"Could not extract video ID from URL: {url}")

    # Strategy 1: youtube-transcript-api (fastest, free, no ffmpeg needed)
    try:
        return await _ingest_via_transcript_api(video_id, url)
    except Exception as e1:
        print(f"[YouTube] Transcript API failed: {e1}")

    # Strategy 2: yt-dlp description/auto-captions without downloading
    try:
        return await _ingest_via_ytdlp_captions(video_id, url)
    except Exception as e2:
        print(f"[YouTube] yt-dlp captions failed: {e2}")

    # Strategy 3: Whisper transcription (requires ffmpeg)
    if not _ffmpeg_available():
        raise RuntimeError(
            "Could not get transcript for this video. "
            "ffmpeg is not installed — install it to enable audio transcription as a fallback. "
            "Run: /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\" "
            "then: brew install ffmpeg"
        )

    return await _ingest_via_whisper(url, video_id)


async def _ingest_via_transcript_api(video_id: str, url: str) -> IngestedContent:
    from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
    import yt_dlp

    loop = asyncio.get_event_loop()

    def _get_transcript():
        ytt = YouTubeTranscriptApi()
        # Try fetching English directly first
        for lang in [["en", "en-US", "en-GB"], None]:
            try:
                result = ytt.fetch(video_id, languages=lang) if lang else ytt.fetch(video_id)
                return list(result)
            except Exception:
                continue
        raise ValueError("No transcripts available")

    entries = await loop.run_in_executor(None, _get_transcript)
    text = " ".join(e.text if hasattr(e, "text") else e.get("text", "") for e in entries)

    if len(text.strip()) < 100:
        raise ValueError("Transcript too short to be useful")

    def _get_metadata():
        ydl_opts = {"quiet": True, "skip_download": True, "no_warnings": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            return ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)

    info = await loop.run_in_executor(None, _get_metadata)

    return IngestedContent(
        text=text,
        title=info.get("title", f"YouTube: {video_id}"),
        content_type="youtube",
        url=url,
        author=info.get("uploader"),
        thumbnail_url=info.get("thumbnail"),
        duration_seconds=info.get("duration"),
        metadata={"video_id": video_id, "view_count": info.get("view_count")},
    )


async def _ingest_via_ytdlp_captions(video_id: str, url: str) -> IngestedContent:
    """Extract auto-captions via yt-dlp without downloading video."""
    import yt_dlp
    import tempfile, os

    loop = asyncio.get_event_loop()

    def _extract():
        with tempfile.TemporaryDirectory() as tmpdir:
            ydl_opts = {
                "quiet": True,
                "skip_download": True,
                "no_warnings": True,
                "writeautomaticsub": True,
                "writesubtitles": True,
                "subtitleslangs": ["en", "en-US"],
                "subtitlesformat": "vtt",
                "outtmpl": os.path.join(tmpdir, "%(id)s.%(ext)s"),
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

            # Find .vtt file
            text_parts = []
            for f in os.listdir(tmpdir):
                if f.endswith(".vtt"):
                    with open(os.path.join(tmpdir, f)) as vf:
                        lines = vf.readlines()
                    # Parse VTT: skip timestamps, deduplicate adjacent lines
                    seen = set()
                    for line in lines:
                        line = line.strip()
                        if (line and not line.startswith("WEBVTT")
                                and "-->" not in line
                                and not line.isdigit()
                                and line not in seen):
                            seen.add(line)
                            text_parts.append(line)

            if not text_parts:
                raise ValueError("No subtitle content found")

            return " ".join(text_parts), info

    text, info = await loop.run_in_executor(None, _extract)

    return IngestedContent(
        text=text,
        title=info.get("title", f"YouTube: {video_id}"),
        content_type="youtube",
        url=url,
        author=info.get("uploader"),
        thumbnail_url=info.get("thumbnail"),
        duration_seconds=info.get("duration"),
        metadata={"video_id": video_id, "transcription_method": "ytdlp_captions"},
    )


async def _ingest_via_whisper(url: str, video_id: str) -> IngestedContent:
    import yt_dlp
    import tempfile, os
    from app.services.transcription import transcribe_audio

    loop = asyncio.get_event_loop()

    with tempfile.TemporaryDirectory() as tmpdir:
        def _download():
            ydl_opts = {
                "format": "bestaudio/best",
                "outtmpl": os.path.join(tmpdir, "audio.%(ext)s"),
                "postprocessors": [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "128",
                }],
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(url, download=True)

        info = await loop.run_in_executor(None, _download)

        audio_path = None
        for fname in os.listdir(tmpdir):
            if fname.endswith(".mp3"):
                audio_path = os.path.join(tmpdir, fname)
                break

        if not audio_path:
            raise RuntimeError("Audio extraction failed")

        text = await transcribe_audio(audio_path)

    return IngestedContent(
        text=text,
        title=info.get("title", f"YouTube: {video_id}"),
        content_type="youtube",
        url=url,
        author=info.get("uploader"),
        thumbnail_url=info.get("thumbnail"),
        duration_seconds=info.get("duration"),
        metadata={"video_id": video_id, "transcription_method": "whisper"},
    )
