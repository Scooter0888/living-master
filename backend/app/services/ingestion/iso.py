"""
ISO disc image ingestion — mounts the ISO, processes it as a DVD folder
(all VOBs, not just the largest), then unmounts.

macOS: uses hdiutil (built-in, no dependencies)
Linux: falls back to 7z extraction if mount requires root
"""
import os
import sys
import shutil
import asyncio
import subprocess
import tempfile
from typing import Optional, Callable, Awaitable

from app.services.ingestion.base import IngestedContent
from app.services.ingestion.dvd import ingest_dvd_folder


async def _mount_iso_macos(iso_path: str) -> str:
    """Mount an ISO image on macOS using hdiutil. Returns the mount point."""
    proc = await asyncio.create_subprocess_exec(
        "hdiutil", "attach", iso_path, "-nobrowse", "-noverify", "-readonly",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"hdiutil failed to mount ISO: {stderr.decode().strip()}")

    # Parse output — last line contains mount point after tabs
    for line in stdout.decode().strip().split("\n"):
        parts = line.split("\t")
        if len(parts) >= 3:
            mount_point = parts[-1].strip()
            if os.path.isdir(mount_point):
                return mount_point

    raise RuntimeError(f"Could not determine mount point from hdiutil output")


async def _unmount_iso_macos(mount_point: str) -> None:
    """Unmount a previously mounted ISO on macOS."""
    proc = await asyncio.create_subprocess_exec(
        "hdiutil", "detach", mount_point, "-force",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    await proc.communicate()


async def _extract_iso_7z(iso_path: str) -> str:
    """Extract all VOBs from ISO using 7z. Returns temp directory path."""
    sevenz = shutil.which("7z") or shutil.which("7za")
    if not sevenz:
        raise RuntimeError(
            "Cannot mount ISO: hdiutil not available and 7z not installed. "
            "Install with: brew install p7zip (or: apt install p7zip-full)"
        )

    tmpdir = tempfile.mkdtemp(prefix="iso_extract_")

    # List ISO contents
    list_result = subprocess.run(
        [sevenz, "l", "-slt", iso_path],
        capture_output=True, text=True, timeout=60,
    )
    if list_result.returncode != 0:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise RuntimeError(f"7z cannot read ISO: {list_result.stderr[:300]}")

    # Find VIDEO_TS directory structure
    vob_paths: list[str] = []
    for line in list_result.stdout.splitlines():
        if line.startswith("Path = "):
            path = line[7:].strip()
            if path.upper().endswith(".VOB"):
                vob_paths.append(path)

    if not vob_paths:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise ValueError("No VOB files found in ISO image. Is this a video DVD?")

    # Extract all VOB files
    extract_result = subprocess.run(
        [sevenz, "e", iso_path, f"-o{tmpdir}", "*.VOB", "-r", "-y"],
        capture_output=True, text=True, timeout=600,
    )
    if extract_result.returncode != 0:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise RuntimeError(f"7z extraction failed: {extract_result.stderr[:300]}")

    return tmpdir


async def ingest_iso(
    file_path: str,
    original_filename: str,
    run_movement_analysis: bool = False,
    on_progress: Optional[Callable[[int, int], Awaitable[None]]] = None,
) -> IngestedContent:
    """Mount/extract an ISO disc image and process all VOBs through the DVD pipeline."""
    if not os.path.isfile(file_path):
        raise ValueError(f"ISO file not found: {file_path}")

    title = os.path.splitext(original_filename)[0]
    use_hdiutil = sys.platform == "darwin"
    mount_point: Optional[str] = None
    tmpdir: Optional[str] = None

    try:
        if use_hdiutil:
            mount_point = await _mount_iso_macos(file_path)
            process_path = mount_point
            print(f"[ISO] Mounted at {mount_point}")
        else:
            tmpdir = await _extract_iso_7z(file_path)
            process_path = tmpdir
            print(f"[ISO] Extracted to {tmpdir}")

        result = await ingest_dvd_folder(
            process_path,
            run_movement_analysis=run_movement_analysis,
            on_progress=on_progress,
        )
        result.title = title
        return result

    finally:
        if mount_point and use_hdiutil:
            print(f"[ISO] Unmounting {mount_point}")
            await _unmount_iso_macos(mount_point)
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)
