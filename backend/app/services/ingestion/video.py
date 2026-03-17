"""
Video file ingestion: extract audio track → transcribe → identify Russian speaker → translate.

Pipeline:
  1. Extract MP3 from video via ffmpeg
  2. Transcribe with task="transcribe" — keeps original language (Russian stays Russian)
  3. Speaker diarization — separates Mikhail (Russian) from translators (English)
  4. Detect Russian speaker → that is the master (Mikhail)
  5. Filter transcript to Russian speaker's segments only
  6. Translate filtered Russian text to English via Claude
  7. Store English text in knowledge base; store original-language segments for transcript viewer

If diarization fails or finds no Russian speaker, falls back to translating all text.
"""
import os
import asyncio
import tempfile
import logging

from app.services.ingestion.base import IngestedContent
from app.services.transcription import transcribe_with_segments

logger = logging.getLogger("living_master.video_ingest")


async def ingest_video(file_path: str, original_filename: str, run_movement_analysis: bool = False) -> IngestedContent:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Video file not found: {file_path}")

    loop = asyncio.get_event_loop()

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        audio_path = tmp.name

    try:
        def _extract_audio():
            import subprocess
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", file_path, "-vn", "-acodec", "libmp3lame", "-q:a", "4", audio_path],
                capture_output=True, text=True,
            )
            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {result.stderr}")

        await loop.run_in_executor(None, _extract_audio)

        # Step 1: Transcribe in original language (Russian stays Russian, English stays English)
        raw_text, transcript_segments = await transcribe_with_segments(audio_path)
        logger.info(f"[Video Ingest] Transcribed {len(transcript_segments)} segments")

        # Step 2: Diarize to separate speakers
        diar_segments = []
        try:
            from app.services.diarization import diarize
            diar_segments = await diarize(audio_path, transcript_text=raw_text, transcript_segments=transcript_segments)
            logger.info(f"[Video Ingest] Diarization: {len(diar_segments)} aligned segments")
        except Exception as e:
            logger.warning(f"[Video Ingest] Diarization skipped: {e}")

    finally:
        if os.path.exists(audio_path):
            os.unlink(audio_path)

    # Step 3: Identify the Russian speaker (= Mikhail)
    from app.services.translation import detect_russian_speaker, translate_to_english, is_russian, translate_segments_to_english

    master_speaker_id = None
    final_text = raw_text
    final_transcript_segments = transcript_segments

    if diar_segments:
        master_speaker_id = detect_russian_speaker(diar_segments)

        if master_speaker_id:
            # Filter aligned segments to only the Russian speaker
            master_segments = [s for s in diar_segments if s.get("speaker") == master_speaker_id]
            logger.info(
                f"[Video Ingest] Master speaker {master_speaker_id}: "
                f"{len(master_segments)}/{len(diar_segments)} segments retained"
            )

            # Build master-only transcript text (still in Russian)
            russian_text = " ".join(s.get("text", "") for s in master_segments if s.get("text", "").strip())

            # Translate Russian → English
            logger.info("[Video Ingest] Translating master speaker segments to English")
            final_text = await translate_to_english(russian_text)

            # Translate the per-segment text too (for TranscriptViewer display)
            master_segments_en = await translate_segments_to_english(master_segments)
            final_transcript_segments = master_segments_en

        else:
            # No Russian speaker found (e.g. English-only seminar) — translate all if needed
            logger.info("[Video Ingest] No Russian speaker detected — translating full transcript if needed")
            final_text = await translate_to_english(raw_text)
            if is_russian(raw_text):
                final_transcript_segments = await translate_segments_to_english(diar_segments)
            else:
                final_transcript_segments = diar_segments

    else:
        # No diarization — translate full transcript if Russian
        logger.info("[Video Ingest] No diarization — translating full transcript if needed")
        final_text = await translate_to_english(raw_text)

    # Movement analysis (optional — runs on the original video file)
    movement_chunks = []
    if run_movement_analysis:
        try:
            from app.services.movement import analyse_video_movements
            master_name = os.path.splitext(original_filename)[0]
            movement_chunks = await analyse_video_movements(
                file_path,
                master_name=master_name,
                transcript_segments=transcript_segments,
            )
            logger.info(f"[Video Ingest] Movement analysis: {len(movement_chunks)} fused chunks")
        except Exception as e:
            logger.warning(f"[Video Ingest] Movement analysis skipped: {e}")

    title = os.path.splitext(original_filename)[0]

    return IngestedContent(
        text=final_text,
        title=title,
        content_type="video",
        metadata={
            "filename": original_filename,
            "master_speaker": master_speaker_id,
        },
        segments=diar_segments,                      # raw diar segments (for speaker ID UI)
        transcript_segments=final_transcript_segments,  # translated + filtered (for viewer)
        video_path="",
        movement_chunks=movement_chunks,
        speaker_label=master_speaker_id,             # propagated to Source.speaker_label
    )
