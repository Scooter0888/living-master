"""
Claude Vision–based movement/action analysis for video keyframes.

For each keyframe we:
1. Extract a frame at timestamp T using ffmpeg
2. Find what was SPOKEN during the window [T-interval/2, T+interval/2] using stored Whisper segments
3. Ask Claude Vision what physical action is happening
4. Fuse speech + vision into a single rich chunk:
   "[2:15] SPOKEN: '...' | PHYSICAL: '...'"

This gives the AI full context: what the person said AND what they were physically doing
when they said it — enabling responses like "when Mikhail explains this technique,
he is simultaneously demonstrating a wrist-catch defense against an overhead strike."
"""
import asyncio
import base64
import os
import subprocess
import tempfile
import shutil
from typing import Optional


def _fmt_time(seconds: float) -> str:
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}:{s:02d}"


def _get_speech_at(transcript_segments: list[dict], t_start: float, t_end: float) -> str:
    """
    Collect all transcript text spoken during the time window [t_start, t_end].
    A segment contributes if it overlaps at all with the window.
    """
    lines = []
    for seg in transcript_segments:
        seg_start = seg.get("start", 0)
        seg_end = seg.get("end", seg_start + 1)
        # Overlaps the window?
        if seg_end >= t_start and seg_start <= t_end:
            text = seg.get("text", "").strip()
            if text:
                lines.append(text)
    return " ".join(lines)


async def extract_keyframes(video_path: str, interval_secs: int = 5) -> list[tuple[str, float]]:
    """
    Extract one frame every `interval_secs` seconds.
    Returns list of (jpeg_path, timestamp_seconds).
    Caller must clean up the temp directory.
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")

    tmpdir = tempfile.mkdtemp(prefix="keyframes_")
    frame_pattern = os.path.join(tmpdir, "frame_%04d.jpg")

    def _extract():
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", video_path,
                "-vf", f"fps=1/{interval_secs}",
                "-q:v", "3",
                frame_pattern,
            ],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg keyframe extraction failed: {result.stderr[-500:]}")

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _extract)

    frames = []
    for fname in sorted(os.listdir(tmpdir)):
        if not fname.endswith(".jpg"):
            continue
        # Frame index is 1-based in ffmpeg output
        try:
            idx = int(fname.replace("frame_", "").replace(".jpg", "")) - 1
        except ValueError:
            idx = len(frames)
        timestamp = idx * interval_secs
        frames.append((os.path.join(tmpdir, fname), float(timestamp)))

    return frames


async def _vision_describe(image_path: str, timestamp: float, master_name: str, spoken_text: str) -> str:
    """
    Call Claude Vision on one frame.
    If we have spoken_text, include it as context so Claude can describe
    the physical action in relation to what's being said.
    """
    with open(image_path, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode("utf-8")

    time_str = _fmt_time(timestamp)

    if spoken_text:
        prompt = (
            f"This is a video frame at {time_str}. "
            f"The subject is {master_name}. "
            f"At this exact moment they are saying: \"{spoken_text}\"\n\n"
            "Describe in 1–2 sentences ONLY the physical action, movement, gesture, or body position visible. "
            "Be specific: body orientation, which limbs are active, what objects are involved, direction of movement. "
            "Do NOT repeat what they are saying — focus purely on the physical dimension."
        )
    else:
        prompt = (
            f"This is a video frame at {time_str}. The subject may be {master_name}. "
            "Describe in 1–2 sentences the physical action, movement, gesture, or body position visible. "
            "Be specific: body orientation, which limbs are active, direction of movement."
        )

    def _call():
        import anthropic
        from app.config import get_settings
        settings = get_settings()
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=256,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_data,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        return msg.content[0].text.strip()

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _call)


async def analyse_video_movements(
    video_path: str,
    master_name: str,
    transcript_segments: Optional[list[dict]] = None,
    interval_secs: int = 5,
) -> list[dict]:
    """
    Full pipeline:
      1. Extract keyframes every `interval_secs` seconds
      2. For each frame, look up the spoken text at that timestamp
      3. Ask Claude Vision to describe the physical action
      4. Fuse into a rich chunk: "[T] SPOKEN: '...' | PHYSICAL: '...'"

    Returns list of {timestamp, text, chunk_index}.
    The `text` field is the fused chunk ready for embedding.
    """
    frames = []
    tmpdir = None
    try:
        frame_data = await extract_keyframes(video_path, interval_secs=interval_secs)
        if not frame_data:
            return []

        tmpdir = os.path.dirname(frame_data[0][0]) if frame_data else None
        results = []

        for i, (frame_path, timestamp) in enumerate(frame_data):
            # Find speech in the window around this frame
            half = interval_secs / 2.0
            spoken = ""
            if transcript_segments:
                spoken = _get_speech_at(
                    transcript_segments,
                    t_start=max(0, timestamp - half),
                    t_end=timestamp + half,
                )

            try:
                physical = await _vision_describe(frame_path, timestamp, master_name, spoken)
            except Exception as e:
                print(f"[Movement] Frame {i} at {_fmt_time(timestamp)} vision failed: {e}")
                continue

            if not physical:
                continue

            time_str = _fmt_time(timestamp)

            # Build the fused chunk
            if spoken:
                fused = (
                    f"[{time_str}] "
                    f"{master_name} says: \"{spoken}\" — "
                    f"At this moment: {physical}"
                )
            else:
                fused = f"[{time_str}] {physical}"

            results.append({
                "timestamp": timestamp,
                "text": fused,
                "chunk_index": i,
                "spoken": spoken,
                "physical": physical,
            })

        return results

    finally:
        # Clean up temp frame images
        if tmpdir and os.path.isdir(tmpdir):
            try:
                shutil.rmtree(tmpdir, ignore_errors=True)
            except Exception:
                pass
