"""
ISO disc image ingestion.
Uses 7z (p7zip) to extract the largest VOB file from the image, then processes as video.
Requires: brew install p7zip
"""
import os
import shutil
import subprocess
import tempfile

from app.services.ingestion.base import IngestedContent


async def ingest_iso(file_path: str, original_filename: str) -> IngestedContent:
    sevenz = shutil.which("7z") or shutil.which("7za")
    if not sevenz:
        raise RuntimeError(
            "7z is not installed. Run: brew install p7zip  (or: apt install p7zip-full)"
        )

    # List ISO contents to find VOB files
    list_result = subprocess.run(
        [sevenz, "l", "-slt", file_path],
        capture_output=True, text=True, timeout=60,
    )
    if list_result.returncode != 0:
        raise RuntimeError(f"7z cannot read ISO: {list_result.stderr[:300]}")

    # Parse file listing for .vob entries
    vob_files: list[tuple[str, int]] = []
    current_path: str | None = None
    current_size = 0
    for line in list_result.stdout.splitlines():
        if line.startswith("Path = "):
            current_path = line[7:].strip()
            current_size = 0
        elif line.startswith("Size = ") and current_path:
            try:
                current_size = int(line[7:].strip())
            except ValueError:
                current_size = 0
            if current_path.upper().endswith(".VOB") and current_size > 0:
                vob_files.append((current_path, current_size))
            current_path = None

    if not vob_files:
        raise ValueError("No VOB files found in ISO image. Is this a video DVD?")

    # Pick the largest VOB — that's the main feature, not menu/extras
    largest_vob_path, _ = max(vob_files, key=lambda x: x[1])
    vob_basename = os.path.basename(largest_vob_path)

    tmpdir = tempfile.mkdtemp(prefix="iso_extract_")
    try:
        extract_result = subprocess.run(
            [sevenz, "e", file_path, f"-o{tmpdir}", largest_vob_path, "-y"],
            capture_output=True, text=True, timeout=300,
        )
        if extract_result.returncode != 0:
            raise RuntimeError(f"7z extraction failed: {extract_result.stderr[:300]}")

        extracted_path = os.path.join(tmpdir, vob_basename)
        if not os.path.exists(extracted_path):
            # Some 7z versions flatten the path — search tmpdir
            found = [f for f in os.listdir(tmpdir) if f.upper().endswith(".VOB")]
            if not found:
                raise RuntimeError("VOB file not found in extraction output")
            extracted_path = os.path.join(tmpdir, found[0])

        # Ingest extracted VOB as video
        from app.services.ingestion.video import ingest_video
        title = os.path.splitext(original_filename)[0]
        result = await ingest_video(extracted_path, f"{title}.vob")
        result.title = title  # Use ISO filename as title
        return result

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
