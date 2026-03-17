"""
Local Whisper transcription.

Backend selection (in priority order):
  1. mlx-whisper  — Apple Silicon only; uses the Neural Engine / GPU via MLX.
                    3–5× faster than CPU on M1/M2/M3. Auto-selected when available.
  2. faster-whisper — CPU fallback (used on Linux/Railway and when mlx is absent).

Model size is controlled via WHISPER_MODEL env var (default: "base").
"""
import asyncio
import logging
from typing import Optional

logger = logging.getLogger("living_master.transcription")

_faster_whisper_model = None

# Detect mlx-whisper once at import time
try:
    import mlx_whisper as _mlx_whisper
    _HAS_MLX = True
    logger.info("mlx-whisper detected — will use Apple Silicon GPU for transcription")
except ImportError:
    _mlx_whisper = None
    _HAS_MLX = False

# MLX model name mapping (mlx-community quantised models)
_MLX_MODEL_MAP = {
    "tiny":   "mlx-community/whisper-tiny-mlx",
    "base":   "mlx-community/whisper-base-mlx",
    "small":  "mlx-community/whisper-small-mlx",
    "medium": "mlx-community/whisper-medium-mlx",
    "large":  "mlx-community/whisper-large-v3-mlx",
}


def _get_faster_whisper_model():
    global _faster_whisper_model
    if _faster_whisper_model is None:
        from faster_whisper import WhisperModel
        from app.config import get_settings
        model_name = get_settings().whisper_model
        _faster_whisper_model = WhisperModel(model_name, device="cpu", compute_type="int8")
        logger.info(f"faster-whisper model loaded: {model_name}")
    return _faster_whisper_model


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
    Uses mlx-whisper on Apple Silicon for a 3–5× speedup; falls back to faster-whisper.
    """
    loop = asyncio.get_event_loop()

    if _HAS_MLX:
        def _transcribe_mlx():
            from app.config import get_settings
            model_name = get_settings().whisper_model
            mlx_model = _MLX_MODEL_MAP.get(model_name, _MLX_MODEL_MAP["base"])
            logger.info(f"mlx-whisper transcribing with {mlx_model}")
            result = _mlx_whisper.transcribe(
                file_path,
                path_or_hf_repo=mlx_model,
                language=language,
                # "transcribe" keeps the original language (Russian stays Russian).
                # We identify the Russian speaker afterwards and translate with Claude.
                # This prevents the translator's English from being mixed with Mikhail's Russian.
                task="transcribe",
                # Prevents hallucination snowballing — each segment decoded independently
                condition_on_previous_text=False,
                # Skip segments where the model is unsure speech is present
                no_speech_threshold=0.6,
                # Discard segments that are suspiciously repetitive (compression ratio too high = hallucination)
                compression_ratio_threshold=2.4,
                # Greedy decoding reduces hallucination vs temperature sampling
                temperature=0.0,
            )
            segs = []
            texts = []
            prev_text = None
            repeat_count = 0
            for seg in result.get("segments", []):
                t = seg.get("text", "").strip()
                if not t:
                    continue
                # Post-process: skip consecutive segments that are identical (hallucination loops)
                if t == prev_text:
                    repeat_count += 1
                    if repeat_count >= 2:
                        continue  # drop the third+ repeat
                else:
                    repeat_count = 0
                prev_text = t
                segs.append({
                    "text": t,
                    "start": round(seg.get("start", 0), 2),
                    "end": round(seg.get("end", 0), 2),
                })
                texts.append(t)
            return " ".join(texts), segs

        text, segments = await loop.run_in_executor(None, _transcribe_mlx)
    else:
        def _transcribe_cpu():
            model = _get_faster_whisper_model()
            raw_segments, info = model.transcribe(
                file_path,
                language=language,
                task="transcribe",
                beam_size=5,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500},
                condition_on_previous_text=False,
                no_speech_threshold=0.6,
                compression_ratio_threshold=2.4,
                temperature=0,
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

        text, segments = await loop.run_in_executor(None, _transcribe_cpu)

    return text.strip(), segments
