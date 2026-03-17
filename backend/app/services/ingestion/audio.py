"""
Audio file ingestion via local Whisper (faster-whisper / mlx-whisper).
Supports: mp3, mp4 audio, wav, m4a, ogg, flac, webm

Transcribes in original language, then translates Russian → English via Claude
so Mikhail's Russian audio is fully searchable in English.
"""
import os
import logging
from app.services.ingestion.base import IngestedContent
from app.services.transcription import transcribe_with_segments

logger = logging.getLogger("living_master.audio_ingest")


async def ingest_audio(file_path: str, original_filename: str) -> IngestedContent:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    # Transcribe in original language (Russian stays Russian)
    raw_text, transcript_segments = await transcribe_with_segments(file_path)
    logger.info(f"[Audio Ingest] Transcribed {len(transcript_segments)} segments")

    # Speaker diarization
    diar_segments = []
    try:
        from app.services.diarization import diarize
        diar_segments = await diarize(file_path, transcript_text=raw_text, transcript_segments=transcript_segments)
        logger.info(f"[Audio Ingest] Diarization: {len(diar_segments)} aligned segments")
    except Exception as e:
        logger.warning(f"[Audio Ingest] Diarization skipped: {e}")

    from app.services.translation import (
        detect_russian_speaker, translate_to_english,
        is_russian, translate_segments_to_english,
    )

    master_speaker_id = None
    final_text = raw_text
    final_transcript_segments = transcript_segments

    if diar_segments:
        master_speaker_id = detect_russian_speaker(diar_segments)
        if master_speaker_id:
            master_segs = [s for s in diar_segments if s.get("speaker") == master_speaker_id]
            russian_text = " ".join(s.get("text", "") for s in master_segs if s.get("text", "").strip())
            final_text = await translate_to_english(russian_text)
            final_transcript_segments = await translate_segments_to_english(master_segs)
            logger.info(f"[Audio Ingest] Filtered to master speaker {master_speaker_id}, translated to English")
        else:
            final_text = await translate_to_english(raw_text)
            if is_russian(raw_text):
                final_transcript_segments = await translate_segments_to_english(diar_segments)
    else:
        final_text = await translate_to_english(raw_text)

    title = os.path.splitext(original_filename)[0]

    return IngestedContent(
        text=final_text,
        title=title,
        content_type="audio",
        metadata={"filename": original_filename, "master_speaker": master_speaker_id},
        segments=diar_segments,
        transcript_segments=final_transcript_segments,
        speaker_label=master_speaker_id,
    )
