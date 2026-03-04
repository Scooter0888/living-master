"""
Local Whisper transcription using faster-whisper.
Model is loaded once and cached. Model size is controlled via WHISPER_MODEL env var.
"""
import asyncio
import logging
from typing import Optional

logger = logging.getLogger("living_master.transcription")

_model = None


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        from app.config import get_settings
        model_name = get_settings().whisper_model
        _model = WhisperModel(model_name, device="cpu", compute_type="int8")
        logger.info(f"Whisper model loaded: {model_name}")
    return _model


async def transcribe_audio(file_path: str, language: Optional[str] = None) -> str:
    """Return full transcript text (backward-compatible)."""
    text, _ = await transcribe_with_segments(file_path, language=language)
    return text


async def transcribe_with_segments(
    file_path: str,
    language: Optional[str] = None,
) -> tuple[str, list[dict]]:
    """
    Transcribe audio and return (full_text, segments).
    segments: list of {text, start, end} — one per Whisper segment (~sentence level).
    Always translates to English regardless of source language.
    """
    loop = asyncio.get_event_loop()

    def _transcribe():
        model = _get_model()
        raw_segments, info = model.transcribe(
            file_path,
            language=language,
            task="translate",  # Always output English regardless of source language
            beam_size=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )
        logger.info(f"Whisper detected language: {info.language} ({info.language_probability:.0%})")
        segs = []
        texts = []
        for seg in raw_segments:
            t = seg.text.strip()
            if t:
                segs.append({"text": t, "start": round(seg.start, 2), "end": round(seg.end, 2)})
                texts.append(t)
        return " ".join(texts), segs

    text, segments = await loop.run_in_executor(None, _transcribe)
    return text.strip(), segments
