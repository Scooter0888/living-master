"""
Backup router: full data export and import for migrating between local and Railway.

Export: GET  /backup/export          → downloads a .zip of the entire data directory
Import: POST /backup/import          → uploads a .zip and restores data directory
Status: GET  /backup/status          → current data directory stats
"""
import io
import os
import shutil
import tempfile
import zipfile
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import StreamingResponse, JSONResponse

from app.config import get_settings

logger = logging.getLogger("living_master.backup")
router = APIRouter(prefix="/backup", tags=["backup"])

# Files/dirs to include in the export zip
_EXPORT_TARGETS = [
    "living_master.db",
    "chroma_db",
    "uploads",
    "photos",
    "voice_samples",
]


def _build_zip(data_dir: str) -> io.BytesIO:
    """Build a zip file in memory containing all data. Returns seeked BytesIO."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for target in _EXPORT_TARGETS:
            full_path = os.path.join(data_dir, target)
            if not os.path.exists(full_path):
                continue
            if os.path.isfile(full_path):
                zf.write(full_path, arcname=target)
                logger.info(f"[Backup] Added file: {target}")
            elif os.path.isdir(full_path):
                for root, dirs, files in os.walk(full_path):
                    # Skip __pycache__ and other junk
                    dirs[:] = [d for d in dirs if not d.startswith("__") and d != ".git"]
                    for fname in files:
                        abs_path = os.path.join(root, fname)
                        rel_path = os.path.relpath(abs_path, data_dir)
                        zf.write(abs_path, arcname=rel_path)
                logger.info(f"[Backup] Added directory: {target}")
    buf.seek(0)
    return buf


def _dir_size_mb(path: str) -> float:
    """Return total size of a directory (or file) in MB."""
    if not os.path.exists(path):
        return 0.0
    if os.path.isfile(path):
        return os.path.getsize(path) / (1024 * 1024)
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total / (1024 * 1024)


def _count_files(path: str) -> int:
    if not os.path.exists(path):
        return 0
    if os.path.isfile(path):
        return 1
    return sum(len(files) for _, _, files in os.walk(path))


@router.get("/status")
async def backup_status():
    """Return sizes and file counts for each data component."""
    settings = get_settings()
    data_dir = settings.data_dir

    info = {}
    for target in _EXPORT_TARGETS:
        full_path = os.path.join(data_dir, target)
        info[target] = {
            "exists": os.path.exists(full_path),
            "size_mb": round(_dir_size_mb(full_path), 2),
            "files": _count_files(full_path),
        }

    total_mb = sum(v["size_mb"] for v in info.values())
    return {
        "data_dir": data_dir,
        "components": info,
        "total_size_mb": round(total_mb, 2),
        "estimated_zip_mb": round(total_mb * 0.6, 2),  # rough compression estimate
    }


@router.get("/export")
async def export_backup():
    """
    Stream a full backup zip of all data (SQLite DB + ChromaDB + uploads + photos + voice).
    Download this from local, then import it on Railway (or vice versa).
    """
    settings = get_settings()
    data_dir = settings.data_dir

    logger.info(f"[Backup] Starting export from {data_dir}")

    try:
        zip_buf = _build_zip(data_dir)
    except Exception as e:
        logger.exception("[Backup] Export failed")
        raise HTTPException(status_code=500, detail=f"Export failed: {e}")

    zip_buf.seek(0, 2)
    size = zip_buf.tell()
    zip_buf.seek(0)
    logger.info(f"[Backup] Export complete — {round(size / (1024*1024), 1)} MB")

    def iter_zip():
        chunk = 65536  # 64 KB chunks
        while True:
            data = zip_buf.read(chunk)
            if not data:
                break
            yield data

    return StreamingResponse(
        iter_zip(),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="living_master_backup.zip"',
            "Content-Length": str(size),
        },
    )


@router.post("/import")
async def import_backup(file: UploadFile = File(...)):
    """
    Restore a full backup zip. Existing data is replaced.

    Steps:
    1. Upload the zip produced by GET /backup/export
    2. This endpoint extracts it and overwrites all data files
    3. Restart the backend after import for ChromaDB to pick up changes
    """
    settings = get_settings()
    data_dir = settings.data_dir

    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload must be a .zip file")

    logger.info(f"[Restore] Starting import into {data_dir}")

    # Write upload to a temp file (avoid loading entire zip into RAM)
    tmp_zip_path = None
    tmp_extract_dir = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp_zip_path = tmp.name
            chunk_size = 65536
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                tmp.write(chunk)

        logger.info(f"[Restore] Zip saved to {tmp_zip_path} ({round(os.path.getsize(tmp_zip_path)/(1024*1024),1)} MB)")

        # Validate zip
        if not zipfile.is_zipfile(tmp_zip_path):
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid zip archive")

        # Extract to temp dir first, then move into place atomically-ish
        tmp_extract_dir = tempfile.mkdtemp(prefix="lm_restore_")
        with zipfile.ZipFile(tmp_zip_path, "r") as zf:
            zf.extractall(tmp_extract_dir)

        extracted = os.listdir(tmp_extract_dir)
        logger.info(f"[Restore] Extracted: {extracted}")

        restored = []
        skipped = []

        for target in _EXPORT_TARGETS:
            src = os.path.join(tmp_extract_dir, target)
            dst = os.path.join(data_dir, target)

            if not os.path.exists(src):
                skipped.append(target)
                continue

            # Remove existing
            if os.path.exists(dst):
                if os.path.isdir(dst):
                    shutil.rmtree(dst)
                else:
                    os.remove(dst)

            # Move into place
            shutil.move(src, dst)
            restored.append(target)
            logger.info(f"[Restore] Restored: {target}")

        logger.info(f"[Restore] Import complete. Restored: {restored}, Skipped: {skipped}")

        return JSONResponse({
            "status": "success",
            "restored": restored,
            "skipped": skipped,
            "message": (
                "Import complete. Restart the backend service for ChromaDB changes to take full effect. "
                "In Railway: go to Deployments → Redeploy."
            ),
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[Restore] Import failed")
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")
    finally:
        if tmp_zip_path and os.path.exists(tmp_zip_path):
            os.remove(tmp_zip_path)
        if tmp_extract_dir and os.path.exists(tmp_extract_dir):
            shutil.rmtree(tmp_extract_dir, ignore_errors=True)
