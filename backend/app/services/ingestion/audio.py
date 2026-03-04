"""
Audio file ingestion via local Whisper (faster-whisper).
Supports: mp3, mp4 audio, wav, m4a, ogg, flac, webm
"""
import os
from app.services.ingestion.base import IngestedContent
from app.services.transcription import transcribe_with_segments


async def ingest_audio(file_path: str, original_filename: str) -> IngestedContent:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    # Get text AND timestamped segments
    text, transcript_segments = await transcribe_with_segments(file_path)
    title = os.path.splitext(original_filename)[0]

    # Optional speaker diarization
    diar_segments = []
    try:
        from app.services.diarization import diarize
        diar_segments = await diarize(file_path, transcript_text=text, transcript_segments=transcript_segments)
    except Exception as e:
        print(f"[Audio Ingest] Diarization skipped: {e}")

    return IngestedContent(
        text=text,
        title=title,
        content_type="audio",
        metadata={"filename": original_filename},
        segments=diar_segments,
        transcript_segments=transcript_segments,
    )
