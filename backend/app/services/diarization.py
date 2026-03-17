"""
Speaker diarization using pyannote.audio.
Falls back gracefully when HUGGINGFACE_TOKEN is not set.
"""
import asyncio
from typing import Optional

# Hard timeout for diarization subprocess (seconds).
# Using a real subprocess (multiprocessing.Process) so we can actually kill it
# when it times out — asyncio.wait_for alone only cancels the coroutine, leaving
# the underlying pyannote thread running and leaking resources.
# 1800s (30 min) covers DVD VOBs up to ~30-60 min on Apple Silicon GPU.
_DIARIZATION_TIMEOUT = 1800


def _run_diarization(audio_path: str, hf_token: str) -> list[dict]:
    """Runs pyannote diarization synchronously in a subprocess worker."""
    from pyannote.audio import Pipeline
    import torch

    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=hf_token,
    )
    if torch.backends.mps.is_available():
        pipeline = pipeline.to(torch.device("mps"))

    diarization = pipeline(audio_path)

    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({
            "speaker": speaker,
            "start": round(turn.start, 2),
            "end": round(turn.end, 2),
        })
    return segments


def _run_diarization_with_hard_timeout(audio_path: str, hf_token: str) -> list[dict]:
    """
    Run diarization in a child process with a real OS-level timeout.
    When timeout fires, the child is SIGTERM'd then SIGKILL'd — no zombie threads.
    This function runs in a thread-pool executor (blocks the thread, not the event loop).
    """
    import multiprocessing

    result_q: multiprocessing.Queue = multiprocessing.Queue()

    def _worker(q: multiprocessing.Queue, path: str, token: str) -> None:
        try:
            q.put(("ok", _run_diarization(path, token)))
        except Exception as exc:
            q.put(("err", str(exc)))

    proc = multiprocessing.Process(target=_worker, args=(result_q, audio_path, hf_token), daemon=True)
    proc.start()
    proc.join(timeout=_DIARIZATION_TIMEOUT)

    if proc.is_alive():
        proc.terminate()
        proc.join(timeout=5)
        if proc.is_alive():
            proc.kill()
        raise TimeoutError(f"Diarization timed out after {_DIARIZATION_TIMEOUT}s")

    try:
        result_type, value = result_q.get_nowait()
    except Exception:
        raise RuntimeError("Diarization process exited without result")

    if result_type == "err":
        raise RuntimeError(value)
    return value


def _align_with_transcript(
    diar_segments: list[dict],
    transcript_text: str,
    transcript_segments: Optional[list[dict]] = None,
) -> list[dict]:
    """
    If faster-whisper gave us word-level segments, align them with diarization.
    Otherwise just return diarization segments with the transcript text chunked.
    """
    if not transcript_segments:
        # No word segments — return diar segments with empty text
        return [
            {"speaker": s["speaker"], "start": s["start"], "end": s["end"], "text": "", "is_master": None}
            for s in diar_segments
        ]

    # Assign each transcript segment to a speaker by max overlap
    result = []
    for ts in transcript_segments:
        ts_start = ts.get("start", 0)
        ts_end = ts.get("end", ts_start + 1)
        ts_text = ts.get("text", "").strip()

        best_speaker = None
        best_overlap = 0.0
        for ds in diar_segments:
            overlap = max(0.0, min(ts_end, ds["end"]) - max(ts_start, ds["start"]))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = ds["speaker"]

        result.append({
            "speaker": best_speaker or "UNKNOWN",
            "start": ts_start,
            "end": ts_end,
            "text": ts_text,
            "is_master": None,
        })

    return result


async def diarize(
    audio_path: str,
    transcript_text: str = "",
    transcript_segments: Optional[list[dict]] = None,
) -> list[dict]:
    """
    Run speaker diarization on the audio file.

    Returns list of dicts: [{speaker, start, end, text, is_master}]
    Returns empty list if HUGGINGFACE_TOKEN is not set or diarization fails.
    """
    from app.config import get_settings
    settings = get_settings()

    if not settings.huggingface_token:
        return []

    try:
        loop = asyncio.get_event_loop()
        # Run in executor — the worker uses multiprocessing.Process internally so
        # it can be hard-killed on timeout (no zombie threads/processes).
        diar_segments = await loop.run_in_executor(
            None, _run_diarization_with_hard_timeout, audio_path, settings.huggingface_token
        )
        return _align_with_transcript(diar_segments, transcript_text, transcript_segments)
    except TimeoutError:
        print(f"[Diarization] Timed out after {_DIARIZATION_TIMEOUT}s — skipping.")
        return []
    except Exception as e:
        print(f"[Diarization] Warning: diarization failed — {e}")
        return []


def count_unique_speakers(segments: list[dict]) -> int:
    return len({s["speaker"] for s in segments if s.get("speaker")})


def get_speaker_samples(segments: list[dict], max_per_speaker: int = 3) -> dict[str, list[str]]:
    """Return first few text samples per speaker for identification UI."""
    samples: dict[str, list[str]] = {}
    for seg in segments:
        spk = seg.get("speaker", "UNKNOWN")
        text = seg.get("text", "").strip()
        if text and spk not in samples:
            samples[spk] = []
        if spk in samples and len(samples[spk]) < max_per_speaker and text:
            samples[spk].append(text)
    return samples
