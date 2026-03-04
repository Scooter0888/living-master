"""
Voice cloning and TTS synthesis.

Three backends, selected automatically:
  1. ElevenLabs (cloud, ~$5/mo) — if ELEVENLABS_API_KEY is set in .env
  2. Coqui XTTS v2  (local, free, true cloning) — if `pip install TTS` done & Python ≤ 3.12
  3. edge-tts       (free, no cloning, high-quality preset voices) — always-available fallback

voice_id stored in DB:
  - ElevenLabs  → short alphanumeric, e.g.  "VwDdo1234ABC"
  - XTTS local  → "local:/abs/path/ref.wav"
  - edge-tts    → "edge:en-US-GuyNeural"
"""
import asyncio
import os
import subprocess
import tempfile
from typing import Optional

LOCAL_PREFIX = "local:"
EDGE_PREFIX = "edge:"

# Good default voice
EDGE_DEFAULT_VOICE = "en-US-GuyNeural"

# Full catalog shown in the voice picker UI
EDGE_VOICE_CATALOG = [
    {"id": "en-US-GuyNeural",         "name": "Guy",         "accent": "US",        "gender": "male",   "description": "Clear, authoritative — confident delivery"},
    {"id": "en-US-ChristopherNeural", "name": "Christopher", "accent": "US",        "gender": "male",   "description": "Deep, mature — measured gravitas"},
    {"id": "en-US-DavisNeural",       "name": "Davis",       "accent": "US",        "gender": "male",   "description": "Expressive, dynamic — natural variation"},
    {"id": "en-GB-RyanNeural",        "name": "Ryan",        "accent": "British",   "gender": "male",   "description": "Calm, precise — understated authority"},
    {"id": "en-AU-WilliamNeural",     "name": "William",     "accent": "Australian","gender": "male",   "description": "Deep, warm — relaxed confidence"},
    {"id": "en-IE-ConnorNeural",      "name": "Connor",      "accent": "Irish",     "gender": "male",   "description": "Warm, distinctive — gentle cadence"},
    {"id": "en-US-JennyNeural",       "name": "Jenny",       "accent": "US",        "gender": "female", "description": "Warm, natural — conversational clarity"},
    {"id": "en-GB-SoniaNeural",       "name": "Sonia",       "accent": "British",   "gender": "female", "description": "Clear, professional — crisp enunciation"},
]


def _is_local(voice_id: Optional[str]) -> bool:
    return bool(voice_id and voice_id.startswith(LOCAL_PREFIX))


def _is_edge(voice_id: Optional[str]) -> bool:
    return bool(voice_id and voice_id.startswith(EDGE_PREFIX))


def _local_ref_path(voice_id: str) -> str:
    return voice_id[len(LOCAL_PREFIX):]


def _edge_voice_name(voice_id: str) -> str:
    return voice_id[len(EDGE_PREFIX):]


def _find_ffmpeg() -> str:
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    local_bin = os.path.join(backend_dir, "ffmpeg")
    if os.path.exists(local_bin) and os.access(local_bin, os.X_OK):
        return local_bin
    import shutil
    system = shutil.which("ffmpeg")
    if system:
        return system
    raise RuntimeError("ffmpeg not found. Place the static ffmpeg binary in the backend/ directory.")


def _coqui_available() -> bool:
    try:
        import importlib.util
        return importlib.util.find_spec("TTS") is not None
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

async def clone_voice(master_name: str, audio_paths: list[str]) -> Optional[str]:
    """
    Set up voice for TTS. Routes based on what is available:
      1. ElevenLabs   — actual voice clone from audio (best quality)
      2. Coqui XTTS   — local real voice clone (free, requires Python ≤ 3.12 + pip install TTS)
      3. edge-tts     — free preset voice (no cloning, but high quality, works always)
    """
    from app.config import get_settings
    settings = get_settings()

    if settings.elevenlabs_api_key:
        return await _clone_elevenlabs(master_name, audio_paths, settings)

    if _coqui_available():
        try:
            return await _clone_local(master_name, audio_paths)
        except Exception as e:
            print(f"[Voice/XTTS] Local clone failed, falling back to edge-tts: {e}")

    # Always-available free fallback: edge-tts preset voice
    return await _assign_edge_voice(master_name)


async def synthesize_speech(voice_id: Optional[str], text: str) -> bytes:
    """
    Synthesize text to speech.
    Routes to the correct backend based on the voice_id prefix.
    """
    from app.config import get_settings
    settings = get_settings()

    if _is_local(voice_id):
        return await _synthesize_xtts(_local_ref_path(voice_id), text)

    if _is_edge(voice_id):
        return await _synthesize_edge(_edge_voice_name(voice_id), text)

    if settings.elevenlabs_api_key:
        return await _synthesize_elevenlabs(voice_id, text, settings)

    raise ValueError(
        "No voice configured. Go to the Media tab and click 'Clone Voice' "
        "to set up a free local voice."
    )


def get_audio_content_type(voice_id: Optional[str]) -> str:
    """Return correct MIME type for audio produced by synthesize_speech."""
    if _is_local(voice_id):
        return "audio/wav"
    return "audio/mpeg"  # both ElevenLabs and edge-tts produce MP3-compatible audio


# ---------------------------------------------------------------------------
# YouTube audio sampling (for cloning when only YouTube sources exist)
# ---------------------------------------------------------------------------

async def download_youtube_voice_samples(
    youtube_urls: list[str],
    master_id: str,
    max_clips: int = 3,
    clip_duration_secs: int = 90,
) -> list[str]:
    """
    Download short audio clips from YouTube URLs for ElevenLabs voice cloning.
    Uses yt-dlp to get the stream URL then ffmpeg to grab only clip_duration_secs seconds.
    Saves to voice_samples/{master_id}/ and returns list of file paths.
    """
    from app.config import get_settings
    settings = get_settings()

    out_dir = os.path.join(settings.voice_samples_path, master_id)
    os.makedirs(out_dir, exist_ok=True)

    saved: list[str] = []

    for i, yt_url in enumerate(youtube_urls[:max_clips]):
        out_path = os.path.join(out_dir, f"sample_{i}.wav")
        try:
            await _download_yt_clip(yt_url, out_path, clip_duration_secs)
            if os.path.exists(out_path) and os.path.getsize(out_path) > 10_000:
                saved.append(out_path)
                print(f"[Voice/YT] Saved {clip_duration_secs}s sample from {yt_url} → {out_path}")
        except Exception as e:
            print(f"[Voice/YT] Failed to download clip from {yt_url}: {e}")

    return saved


async def _download_yt_clip(yt_url: str, out_wav: str, duration_secs: int) -> None:
    """
    Get best-audio stream URL from yt-dlp, then use ffmpeg to capture just
    the first duration_secs seconds — avoids downloading the full video.
    """
    import yt_dlp

    def _get_stream_url() -> str:
        ydl_opts = {
            "format": "bestaudio/best",
            "quiet": True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(yt_url, download=False)
            # For formats list, pick the best audio
            if "url" in info:
                return info["url"]
            formats = info.get("formats", [])
            # Sort by audio quality, pick best
            audio_fmts = [f for f in formats if f.get("acodec") != "none" and f.get("vcodec") == "none"]
            if audio_fmts:
                best = max(audio_fmts, key=lambda f: f.get("abr") or 0)
                return best["url"]
            return info["formats"][-1]["url"]

    stream_url = await asyncio.get_event_loop().run_in_executor(None, _get_stream_url)

    ffmpeg = _find_ffmpeg()

    def _ffmpeg_clip():
        cmd = [
            ffmpeg,
            "-i", stream_url,
            "-t", str(duration_secs),
            "-ar", "16000",
            "-ac", "1",
            out_wav,
            "-y",
            "-loglevel", "error",
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg clip failed: {result.stderr.decode()[:200]}")

    await asyncio.get_event_loop().run_in_executor(None, _ffmpeg_clip)


# ---------------------------------------------------------------------------
# ElevenLabs backend
# ---------------------------------------------------------------------------

async def _clone_elevenlabs(master_name: str, audio_paths: list[str], settings) -> str:
    def _clone():
        from elevenlabs.client import ElevenLabs
        client = ElevenLabs(api_key=settings.elevenlabs_api_key)
        audio_files = []
        try:
            for path in audio_paths:
                if os.path.exists(path):
                    audio_files.append(open(path, "rb"))
            if not audio_files:
                raise ValueError("No valid audio files provided for voice cloning")
            voice = client.clone(
                name=f"{master_name} Voice",
                description=f"AI voice clone of {master_name} created from their recorded speech",
                files=audio_files,
            )
            return voice.voice_id
        finally:
            for f in audio_files:
                f.close()

    return await asyncio.get_event_loop().run_in_executor(None, _clone)


async def _synthesize_elevenlabs(voice_id: Optional[str], text: str, settings) -> bytes:
    text = text[:4000]

    def _synth():
        from elevenlabs.client import ElevenLabs
        client = ElevenLabs(api_key=settings.elevenlabs_api_key)
        target = voice_id or "21m00Tcm4TlvDq8ikWAM"  # Rachel fallback
        audio = client.generate(
            text=text,
            voice=target,
            model="eleven_multilingual_v2",
        )
        return b"".join(audio)

    return await asyncio.get_event_loop().run_in_executor(None, _synth)


# ---------------------------------------------------------------------------
# Coqui XTTS v2 backend (local, free, requires pip install TTS on Python ≤ 3.12)
# ---------------------------------------------------------------------------

async def _clone_local(master_name: str, audio_paths: list[str]) -> str:
    """
    Create a reference audio file for XTTS v2 voice conditioning.
    XTTS uses the reference at synthesis time rather than pre-training a model.
    Returns voice_id = "local:/abs/path/ref.wav"
    """
    valid_paths = [p for p in audio_paths if os.path.exists(p)]
    if not valid_paths:
        raise ValueError("No valid audio files found for voice cloning")

    best = max(valid_paths, key=lambda p: os.path.getsize(p))

    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    voice_refs_dir = os.path.join(backend_dir, "voice_refs")
    os.makedirs(voice_refs_dir, exist_ok=True)

    safe_name = "".join(c if c.isalnum() or c == "_" else "_" for c in master_name)
    ref_path = os.path.join(voice_refs_dir, f"{safe_name}_ref.wav")

    def _convert():
        ffmpeg = _find_ffmpeg()
        cmd = [ffmpeg, "-i", best, "-ar", "16000", "-ac", "1", "-t", "30",
               ref_path, "-y", "-loglevel", "error"]
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            cmd2 = [ffmpeg, "-i", best, "-ar", "16000", "-ac", "1",
                    ref_path, "-y", "-loglevel", "error"]
            subprocess.run(cmd2, check=True, capture_output=True)

    await asyncio.get_event_loop().run_in_executor(None, _convert)

    if not os.path.exists(ref_path) or os.path.getsize(ref_path) == 0:
        raise ValueError("ffmpeg conversion produced no output — cannot create reference audio")

    print(f"[Voice/XTTS] Reference audio saved: {ref_path}")
    return f"{LOCAL_PREFIX}{ref_path}"


async def _synthesize_xtts(ref_path: str, text: str) -> bytes:
    """Synthesize with Coqui XTTS v2. First call downloads model (~1.5 GB), then offline forever."""
    if not os.path.exists(ref_path):
        raise ValueError(
            f"Voice reference audio missing: {ref_path}. Please re-clone the voice."
        )
    text = text[:600].strip()
    if not text:
        raise ValueError("Empty text")

    def _synth():
        from TTS.api import TTS
        tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            out_path = f.name
        try:
            tts.tts_to_file(text=text, speaker_wav=ref_path, language="en", file_path=out_path)
            with open(out_path, "rb") as f:
                return f.read()
        finally:
            if os.path.exists(out_path):
                os.unlink(out_path)

    return await asyncio.get_event_loop().run_in_executor(None, _synth)


# ---------------------------------------------------------------------------
# edge-tts backend (always available, free, high-quality, no voice cloning)
# ---------------------------------------------------------------------------

async def _assign_edge_voice(master_name: str) -> str:
    """
    Assign an edge-tts preset voice. No cloning — just pick a good voice.
    Returns voice_id = "edge:en-US-GuyNeural"
    """
    # Default to a clear, authoritative English voice
    print(f"[Voice/edge-tts] Assigning preset voice for {master_name}: {EDGE_DEFAULT_VOICE}")
    return f"{EDGE_PREFIX}{EDGE_DEFAULT_VOICE}"


async def _synthesize_edge(voice_name: str, text: str) -> bytes:
    """
    Synthesize using Microsoft edge-tts (free, no API key, high quality).
    Uses the same TTS engine as Microsoft Edge browser — no sign-up required.
    Returns MP3 audio bytes.
    """
    import edge_tts
    text = text[:800].strip()
    if not text:
        raise ValueError("Empty text")

    communicate = edge_tts.Communicate(text=text, voice=voice_name)
    audio_chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_chunks.append(chunk["data"])

    if not audio_chunks:
        raise ValueError("edge-tts produced no audio output")

    return b"".join(audio_chunks)
