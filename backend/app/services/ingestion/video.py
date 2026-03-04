"""
Video file ingestion: extract audio track → transcribe → movement analysis → delete video.

The video file is used during ingestion and then deleted.
Movement analysis (Claude Vision keyframe fusion) runs automatically during ingestion
while the file is still available, producing fused speech+vision chunks.
No large files are kept on disk after ingestion completes.
"""
import os
import asyncio
import tempfile
from app.services.ingestion.base import IngestedContent
from app.services.transcription import transcribe_with_segments


async def ingest_video(file_path: str, original_filename: str) -> IngestedContent:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Video file not found: {file_path}")

    loop = asyncio.get_event_loop()

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        audio_path = tmp.name

    try:
        def _extract_audio():
            import subprocess
            result = subprocess.run(
                [
                    "ffmpeg", "-y", "-i", file_path,
                    "-vn",
                    "-acodec", "libmp3lame",
                    "-q:a", "4",
                    audio_path,
                ],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {result.stderr}")

        await loop.run_in_executor(None, _extract_audio)

        # Get text AND timestamped segments from Whisper
        text, transcript_segments = await transcribe_with_segments(audio_path)

        # Optional speaker diarization
        diar_segments = []
        try:
            from app.services.diarization import diarize
            diar_segments = await diarize(audio_path, transcript_text=text, transcript_segments=transcript_segments)
        except Exception as e:
            print(f"[Video Ingest] Diarization skipped: {e}")

    finally:
        if os.path.exists(audio_path):
            os.unlink(audio_path)

    # Run movement analysis NOW while the video file still exists.
    # Fuses each keyframe's visual description with the spoken words at that timestamp.
    # After this, the video file can be safely deleted.
    movement_chunks = []
    try:
        from app.services.movement import analyse_video_movements
        master_name = os.path.splitext(original_filename)[0]  # best-effort name before DB lookup
        movement_chunks = await analyse_video_movements(
            file_path,
            master_name=master_name,
            transcript_segments=transcript_segments,
        )
        print(f"[Video Ingest] Movement analysis: {len(movement_chunks)} fused chunks")
    except Exception as e:
        print(f"[Video Ingest] Movement analysis skipped: {e}")

    title = os.path.splitext(original_filename)[0]

    return IngestedContent(
        text=text,
        title=title,
        content_type="video",
        metadata={"filename": original_filename},
        segments=diar_segments,
        transcript_segments=transcript_segments,
        video_path="",      # intentionally blank — video will be deleted after ingestion
        movement_chunks=movement_chunks,
    )
