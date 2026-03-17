"""
DVD folder ingestion — processes a VIDEO_TS directory or mounted disc.
Finds all VOB files (excluding menu VOBs < 50 MB), transcribes them in order,
and returns a single merged IngestedContent.
"""
import os
from typing import Callable, Awaitable, Optional
from app.services.ingestion.base import IngestedContent


def _find_vob_files(path: str) -> list[str]:
    """Return content VOBs sorted by name, skipping tiny menu files."""
    video_ts = path
    # Accept /Volumes/DVD, /Volumes/DVD/VIDEO_TS, or bare VIDEO_TS path
    # Check VIDEO_TS subdirectory first — root path always exists as a dir so must come last
    for candidate in [os.path.join(path, "VIDEO_TS"), os.path.join(path, "video_ts"), path]:
        if os.path.isdir(candidate):
            video_ts = candidate
            break

    vobs = []
    for f in sorted(os.listdir(video_ts)):
        if f.upper().endswith(".VOB"):
            full = os.path.join(video_ts, f)
            size = os.path.getsize(full)
            if size > 50 * 1024 * 1024:  # skip files < 50 MB (menus, trailers)
                vobs.append(full)

    return vobs


async def ingest_dvd_folder(
    folder_path: str,
    run_movement_analysis: bool = False,
    on_progress: Optional[Callable[[int, int], Awaitable[None]]] = None,
) -> IngestedContent:
    if not os.path.isdir(folder_path):
        raise ValueError(f"Not a directory: {folder_path}")

    vobs = _find_vob_files(folder_path)
    if not vobs:
        raise ValueError(
            f"No content VOB files found in {folder_path}. "
            "Make sure it contains a VIDEO_TS folder with .VOB files."
        )

    from app.services.ingestion.video import ingest_video

    all_texts: list[str] = []
    all_segments: list = []
    all_transcript_segments: list = []
    all_movement_chunks: list = []
    title = os.path.basename(folder_path.rstrip("/"))
    total = len(vobs)

    for idx, vob_path in enumerate(vobs):
        vob_name = os.path.basename(vob_path)
        print(f"[DVD] Processing {vob_name} ({os.path.getsize(vob_path) // (1024*1024)} MB) [{idx+1}/{total}]")
        try:
            result = await ingest_video(vob_path, vob_name, run_movement_analysis=run_movement_analysis)
            if result.text.strip():
                all_texts.append(result.text)
            all_segments.extend(result.segments)
            all_transcript_segments.extend(result.transcript_segments)
            all_movement_chunks.extend(result.movement_chunks)
        except Exception as e:
            print(f"[DVD] Skipping {vob_name}: {e}")
            continue

        if on_progress:
            await on_progress(idx + 1, total)

    if not all_texts:
        raise ValueError("Could not extract any text from the DVD VOB files")

    merged_text = "\n\n".join(all_texts)
    return IngestedContent(
        text=merged_text,
        title=title,
        content_type="video",
        metadata={"source": "dvd", "vob_count": len(vobs)},
        segments=all_segments,
        transcript_segments=all_transcript_segments,
        movement_chunks=all_movement_chunks,
    )
