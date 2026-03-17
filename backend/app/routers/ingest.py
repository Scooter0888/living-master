import os
import uuid
import json
import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form

# Global semaphore — limits concurrent ingestion jobs to 2.
# Prevents MLX/Metal resource contention and thread-pool exhaustion when many
# sources are queued at once (e.g. "Retry All Failed" with 40+ sources).
_ingest_semaphore: asyncio.Semaphore | None = None

def _get_semaphore() -> asyncio.Semaphore:
    global _ingest_semaphore
    if _ingest_semaphore is None:
        _ingest_semaphore = asyncio.Semaphore(2)
    return _ingest_semaphore
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import Master, Source, IngestionStatus, ContentType
from app.services.ingestion import ingest_url, ingest_file, detect_content_type
from app.services.embeddings import chunk_text, embed_texts
from app.services.vector_store import add_documents, delete_source_chunks
from app.config import get_settings
from app.services.diarization import count_unique_speakers, get_speaker_samples

def _user_friendly_error(err: str) -> str:
    """Convert raw Python exception strings into readable user messages."""
    low = err.lower()
    if "'_type'" in err or "keyerror" in low:
        return "File could not be parsed — try re-uploading or converting to a different format."
    if "ffmpeg" in low:
        return "Audio extraction failed — ensure the file is a valid video/audio format."
    if "requested format is not available" in low:
        return "This video has no downloadable audio format available on YouTube."
    if "no transcripts available" in low or "transcript api failed" in low:
        return "No captions or audio available for this video."
    if "timeout" in low or "timed out" in low:
        return "Processing timed out — the file may be too large or the service was busy."
    if "401" in err or "unauthorized" in low:
        return "Authentication error — check API keys in your .env file."
    if "rate limit" in low or "429" in err:
        return "Rate limited by external API — will retry automatically."
    if "connection" in low or "network" in low:
        return "Network error — check your internet connection."
    # Return the raw error if it's already readable (doesn't look like a Python repr)
    if err.startswith("'") and err.endswith("'"):
        return f"Parse error: {err}. Try re-uploading the file."
    return err


_EMPTY_CONTENT_PHRASES = (
    "No text could be extracted",
    "Expected Embeddings to be non-empty",
    "Transcript too short",
    "Wikipedia API returned no content",
    "Could not extract meaningful content",
    "No subtitle content found",
    "no text",
)

def _is_empty_content_error(err: str) -> bool:
    low = err.lower()
    return any(p.lower() in low for p in _EMPTY_CONTENT_PHRASES)

router = APIRouter(prefix="/masters/{master_id}/ingest", tags=["ingest"])


class IngestURLRequest(BaseModel):
    url: str


async def _process_source_impl(source_id: str, master_id: str, db_session_factory, content=None, file_path: Optional[str] = None, original_filename: Optional[str] = None, run_movement_analysis: bool = False):
    """Core ingestion logic: extract text → chunk → embed → store."""
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Source).where(Source.id == source_id))
        source = result.scalar_one_or_none()
        if not source:
            return

        _STAGE_PCT = {
            "Starting…": 2,
            "Transcribing audio…": 10,
            "Downloading & transcribing…": 10,
            "Extracting PDF text…": 20,
            "Fetching page content…": 25,
            "Processing file…": 10,
            "Chunking text…": 80,
            "Indexing…": 95,
        }

        async def _set_stage(stage: str, pct: int | None = None):
            source.processing_stage = stage
            source.progress_pct = pct if pct is not None else _STAGE_PCT.get(stage)
            await db.commit()

        try:
            source.status = IngestionStatus.processing
            # Only show "Starting…" if content not already pre-ingested (e.g. DVD pre-transcribed)
            if not content:
                source.processing_stage = "Starting…"
                source.progress_pct = 2
            await db.commit()

            # Ingest content (download / transcribe / extract)
            if file_path and original_filename:
                content_type_hint = detect_content_type(original_filename)
                if content_type_hint in ("video", "audio"):
                    await _set_stage("Transcribing audio…")
                elif content_type_hint == "youtube":
                    await _set_stage("Downloading & transcribing…")
                elif content_type_hint == "pdf":
                    await _set_stage("Extracting PDF text…")
                elif content_type_hint == "web":
                    await _set_stage("Fetching page content…")
                else:
                    await _set_stage("Processing file…")
                ingested = await ingest_file(file_path, original_filename, run_movement_analysis=run_movement_analysis)
            else:
                ingested = content

            # Chunk
            await _set_stage("Chunking text…")
            chunks = chunk_text(ingested.text)
            if not chunks:
                raise ValueError("No text could be extracted from this source")

            # Embed — pct scales with chunk count (88–94%)
            n = len(chunks)
            await _set_stage(f"Embedding {n} chunks…", pct=88)
            embeddings = await embed_texts(chunks)

            # Build metadata for each chunk
            metadatas = [
                {
                    "source_id": source_id,
                    "master_id": master_id,
                    "title": ingested.title or source.title or "Untitled",
                    "url": ingested.url or source.url or "",
                    "content_type": ingested.content_type,
                    "chunk_index": i,
                }
                for i in range(len(chunks))
            ]

            # Store in Chroma
            await _set_stage("Indexing…")
            await add_documents(master_id, source_id, chunks, metadatas, embeddings)

            # Save transcript segments (timestamped) for audio sources
            transcript_segments = getattr(ingested, "transcript_segments", [])
            if transcript_segments:
                source.transcript_segments_json = json.dumps(transcript_segments)

            # Store pre-computed movement chunks (fused speech+vision, produced during video ingestion)
            movement_chunks = getattr(ingested, "movement_chunks", [])
            if movement_chunks:
                mov_texts = [m["text"] for m in movement_chunks]
                mov_embeddings = await embed_texts(mov_texts)
                mov_metadatas = [
                    {
                        "source_id": source_id,
                        "master_id": master_id,
                        "title": f"{ingested.title or source.title} — Movement Analysis",
                        "url": ingested.url or source.url or "",
                        "content_type": "movement_analysis",
                        "chunk_index": m["chunk_index"],
                        "timestamp": m["timestamp"],
                    }
                    for m in movement_chunks
                ]
                await add_documents(master_id, f"{source_id}-movements", mov_texts, mov_metadatas, mov_embeddings)
                source.has_movement_analysis = True

            # Handle diarization results
            diar_segments = getattr(ingested, "segments", [])
            needs_speaker_id = False
            if diar_segments:
                n_speakers = count_unique_speakers(diar_segments)
                source.has_diarization = True
                source.speaker_count = n_speakers
                samples = get_speaker_samples(diar_segments)
                source.speaker_samples_json = json.dumps(samples)
                source.error_message = None
                if n_speakers > 1:
                    needs_speaker_id = True

            # Update source record
            if needs_speaker_id:
                source.status = IngestionStatus.needs_speaker_id
            else:
                source.status = IngestionStatus.completed
            source.processing_stage = None
            source.progress_pct = None
            source.chunk_count = len(chunks) + len(movement_chunks)
            source.word_count = len(ingested.text.split())
            source.title = ingested.title or source.title
            source.author = ingested.author
            source.thumbnail_url = ingested.thumbnail_url
            source.duration_seconds = ingested.duration_seconds
            # Propagate the detected master speaker ID (Russian voice = Mikhail)
            if ingested.speaker_label:
                source.speaker_label = ingested.speaker_label
            await db.commit()

        except Exception as e:
            err_str = str(e)
            print(f"[Ingest] Error processing source {source_id}: {err_str}")
            if _is_empty_content_error(err_str):
                await db.delete(source)
            else:
                source.status = IngestionStatus.failed
                source.processing_stage = None
                source.progress_pct = None
                source.error_message = _user_friendly_error(err_str)
            await db.commit()
        finally:
            # Delete uploaded file — movement analysis already ran during ingestion
            if file_path and os.path.exists(file_path):
                os.unlink(file_path)


async def _process_source(source_id: str, master_id: str, db_session_factory, content=None, file_path: Optional[str] = None, original_filename: Optional[str] = None, run_movement_analysis: bool = False):
    """Semaphore-gated wrapper around _process_source_impl.
    Limits concurrent ingestion to 2 to prevent MLX/Metal contention and thread exhaustion.
    """
    async with _get_semaphore():
        await _process_source_impl(
            source_id=source_id,
            master_id=master_id,
            db_session_factory=db_session_factory,
            content=content,
            file_path=file_path,
            original_filename=original_filename,
            run_movement_analysis=run_movement_analysis,
        )


@router.post("/url", status_code=202)
async def ingest_from_url(
    master_id: str,
    body: IngestURLRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    # If this URL already exists and failed, auto-reingest it instead of blocking
    existing_result = await db.execute(
        select(Source).where(Source.master_id == master_id, Source.url == body.url)
    )
    existing_source = existing_result.scalar_one_or_none()
    if existing_source:
        if existing_source.status == IngestionStatus.failed:
            # Reuse existing source record — reset and retry
            await delete_source_chunks(master_id, existing_source.id)
            existing_source.status = IngestionStatus.pending
            existing_source.error_message = None
            existing_source.chunk_count = 0
            existing_source.word_count = 0
            await db.commit()
            reuse_id = existing_source.id
            reuse_url = body.url

            async def _retry_existing():
                from app.database import AsyncSessionLocal
                try:
                    ingested = await ingest_url(reuse_url)
                    await _process_source(source_id=reuse_id, master_id=master_id,
                                          db_session_factory=AsyncSessionLocal, content=ingested)
                except Exception as e:
                    err_str = str(e)
                    async with AsyncSessionLocal() as db2:
                        r = await db2.execute(select(Source).where(Source.id == reuse_id))
                        src = r.scalar_one_or_none()
                        if src:
                            src.status = IngestionStatus.failed
                            src.error_message = _user_friendly_error(err_str)
                            await db2.commit()

            background_tasks.add_task(_retry_existing)
            return {"source_id": reuse_id, "status": "processing", "message": f"Retrying {reuse_url}"}
        else:
            raise HTTPException(status_code=409, detail="This URL has already been added to this master")

    content_type_str = detect_content_type(body.url)
    try:
        content_type = ContentType(content_type_str)
    except ValueError:
        content_type = ContentType.web

    source = Source(
        id=str(uuid.uuid4()),
        master_id=master_id,
        url=body.url,
        title=body.url,
        content_type=content_type,
        status=IngestionStatus.pending,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)

    # Ingest content synchronously here to get metadata, then process in background
    async def _ingest_and_process():
        from app.database import AsyncSessionLocal

        # Set stage to reflect the download/fetch step before _process_source takes over
        async with AsyncSessionLocal() as db2:
            result2 = await db2.execute(select(Source).where(Source.id == source.id))
            src = result2.scalar_one_or_none()
            if src:
                src.status = IngestionStatus.processing
                is_yt = content_type_str == "youtube"
                src.processing_stage = "Downloading & transcribing…" if is_yt else "Fetching content…"
                await db2.commit()

        try:
            ingested = await ingest_url(body.url)
            await _process_source(
                source_id=source.id,
                master_id=master_id,
                db_session_factory=AsyncSessionLocal,
                content=ingested,
            )
        except Exception as e:
            err_str = str(e)
            async with AsyncSessionLocal() as db2:
                result2 = await db2.execute(select(Source).where(Source.id == source.id))
                src = result2.scalar_one_or_none()
                if src:
                    if _is_empty_content_error(err_str):
                        await db2.delete(src)
                    else:
                        src.status = IngestionStatus.failed
                        src.processing_stage = None
                        src.error_message = _user_friendly_error(err_str)
                    await db2.commit()

    background_tasks.add_task(_ingest_and_process)

    return {
        "source_id": source.id,
        "status": "processing",
        "message": f"Ingesting {body.url}",
    }


@router.post("/file", status_code=202)
async def ingest_from_file(
    master_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    analyse_movements: str = Form("0"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    settings = get_settings()
    original_filename = file.filename or "upload"
    content_type_str = detect_content_type(original_filename)

    allowed_types = {"audio", "video", "pdf", "docx", "iso"}
    if content_type_str not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Supported: MP3, WAV, M4A, MP4, MKV, MOV, VOB, ISO, PDF, DOCX"
        )

    # Save file to disk
    os.makedirs(settings.uploads_path, exist_ok=True)
    file_ext = os.path.splitext(original_filename)[1]
    saved_path = os.path.join(settings.uploads_path, f"{uuid.uuid4()}{file_ext}")

    content = await file.read()

    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {settings.max_upload_mb}MB"
        )

    with open(saved_path, "wb") as f:
        f.write(content)

    try:
        content_type = ContentType(content_type_str)
    except ValueError:
        content_type = ContentType.text

    source = Source(
        id=str(uuid.uuid4()),
        master_id=master_id,
        url=None,
        title=original_filename,
        content_type=content_type,
        status=IngestionStatus.pending,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)

    background_tasks.add_task(
        _process_source,
        source_id=source.id,
        master_id=master_id,
        db_session_factory=None,
        content=None,
        file_path=saved_path,
        original_filename=original_filename,
        run_movement_analysis=analyse_movements.strip() in ("1", "true", "yes"),
    )

    return {
        "source_id": source.id,
        "status": "processing",
        "message": f"Processing {original_filename}",
    }


@router.get("/scan-local")
async def scan_local_sources():
    """
    Scan for locally available video sources: mounted DVDs, disc images, and
    video files in common locations. Returns one-click-ingestable items.
    """
    found = []

    # Mounted volumes (DVDs, disc images, external drives)
    volumes_dir = "/Volumes"
    if os.path.isdir(volumes_dir):
        for vol_name in sorted(os.listdir(volumes_dir)):
            vol_path = os.path.join(volumes_dir, vol_name)
            if not os.path.isdir(vol_path):
                continue
            # Skip system volumes
            if vol_name in ("Macintosh HD", "Preboot", "Recovery", "VM", "Update", "Data"):
                continue
            video_ts = os.path.join(vol_path, "VIDEO_TS")
            if os.path.isdir(video_ts):
                found.append({
                    "label": vol_name,
                    "path": vol_path,
                    "type": "dvd",
                    "detail": "Mounted DVD",
                })

    # Common video file locations
    home = os.path.expanduser("~")
    search_dirs = [
        os.path.join(home, "Movies"),
        os.path.join(home, "Desktop"),
        os.path.join(home, "Downloads"),
    ]
    VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".avi", ".m4v", ".vob", ".iso"}
    for search_dir in search_dirs:
        if not os.path.isdir(search_dir):
            continue
        for fname in sorted(os.listdir(search_dir)):
            if os.path.splitext(fname)[1].lower() in VIDEO_EXTS:
                full_path = os.path.join(search_dir, fname)
                if os.path.isfile(full_path):
                    size_mb = os.path.getsize(full_path) // (1024 * 1024)
                    found.append({
                        "label": fname,
                        "path": full_path,
                        "type": "file",
                        "detail": f"{size_mb} MB · {os.path.basename(search_dir)}",
                    })

    return {"sources": found}


class IngestLocalPathRequest(BaseModel):
    path: str
    analyse_movements: bool = False


@router.post("/local-path", status_code=202)
async def ingest_from_local_path(
    master_id: str,
    body: IngestLocalPathRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Ingest a local file or DVD folder without uploading. Useful for large files (DVDs, ISOs)."""
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    path = body.path.strip()
    if not os.path.exists(path):
        raise HTTPException(status_code=400, detail=f"Path not found: {path}")

    # Determine what kind of path this is
    is_dvd_folder = os.path.isdir(path)
    if is_dvd_folder:
        display_title = os.path.basename(path.rstrip("/")) or path
        content_type = ContentType.video
    else:
        fname = os.path.basename(path)
        content_type_str = detect_content_type(fname)
        try:
            content_type = ContentType(content_type_str)
        except ValueError:
            content_type = ContentType.video
        display_title = fname

    source = Source(
        id=str(uuid.uuid4()),
        master_id=master_id,
        url=None,
        title=display_title,
        content_type=content_type,
        status=IngestionStatus.pending,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)

    async def _ingest_local():
        from app.database import AsyncSessionLocal
        try:
            if is_dvd_folder:
                from app.services.ingestion.dvd import ingest_dvd_folder

                # Set source to processing early so progress is visible during transcription
                async with AsyncSessionLocal() as db2:
                    r = await db2.execute(select(Source).where(Source.id == source.id))
                    src = r.scalar_one_or_none()
                    if src:
                        src.status = IngestionStatus.processing
                        src.processing_stage = "Starting transcription…"
                        src.progress_pct = 2
                        await db2.commit()

                async def _dvd_progress(completed: int, total: int):
                    pct = 10 + int(completed / total * 68)  # 10% → 78% across VOBs
                    stage = f"Transcribing VOB {completed}/{total}…"
                    async with AsyncSessionLocal() as db2:
                        r = await db2.execute(select(Source).where(Source.id == source.id))
                        src = r.scalar_one_or_none()
                        if src:
                            src.processing_stage = stage
                            src.progress_pct = pct
                            await db2.commit()

                ingested = await ingest_dvd_folder(path, run_movement_analysis=body.analyse_movements, on_progress=_dvd_progress)
            else:
                ingested = await ingest_file(path, display_title, run_movement_analysis=body.analyse_movements)
            await _process_source(
                source_id=source.id,
                master_id=master_id,
                db_session_factory=AsyncSessionLocal,
                content=ingested,
            )
        except Exception as e:
            err_str = str(e)
            async with AsyncSessionLocal() as db2:
                r = await db2.execute(select(Source).where(Source.id == source.id))
                src = r.scalar_one_or_none()
                if src:
                    if _is_empty_content_error(err_str):
                        await db2.delete(src)
                    else:
                        src.status = IngestionStatus.failed
                        src.error_message = _user_friendly_error(err_str)
                    await db2.commit()

    background_tasks.add_task(_ingest_local)

    return {
        "source_id": source.id,
        "status": "processing",
        "message": f"Processing {display_title}",
    }


@router.post("/retry-failed", status_code=202)
async def retry_all_failed(
    master_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Reset all failed URL sources and re-queue them for ingestion."""
    result = await db.execute(
        select(Source).where(
            Source.master_id == master_id,
            Source.status == IngestionStatus.failed,
            Source.url.isnot(None),
        )
    )
    failed_sources = result.scalars().all()
    if not failed_sources:
        return {"retried": 0, "message": "No failed URL sources to retry"}

    source_ids_urls = [(s.id, s.url) for s in failed_sources]

    # Reset all at once
    for s in failed_sources:
        s.status = IngestionStatus.pending
        s.error_message = None
        s.chunk_count = 0
        s.word_count = 0
    await db.commit()

    async def _retry_all():
        from app.database import AsyncSessionLocal
        import asyncio
        for source_id, url in source_ids_urls:
            try:
                await delete_source_chunks(master_id, source_id)
                ingested = await ingest_url(url)
                await _process_source(source_id=source_id, master_id=master_id,
                                      db_session_factory=AsyncSessionLocal, content=ingested)
            except Exception as e:
                err_str = str(e)
                async with AsyncSessionLocal() as db2:
                    r = await db2.execute(select(Source).where(Source.id == source_id))
                    src = r.scalar_one_or_none()
                    if src:
                        src.status = IngestionStatus.failed
                        src.error_message = _user_friendly_error(err_str)
                        await db2.commit()
            # Small delay between requests to avoid rate limiting
            await asyncio.sleep(1)

    background_tasks.add_task(_retry_all)
    return {"retried": len(source_ids_urls), "message": f"Retrying {len(source_ids_urls)} failed sources"}


@router.post("/sources/{source_id}/reingest", status_code=202)
async def reingest_source(
    master_id: str,
    source_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Re-run ingestion for a URL-based source (clears old chunks and re-processes)."""
    result = await db.execute(
        select(Source).where(Source.id == source_id, Source.master_id == master_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    if not source.url:
        raise HTTPException(status_code=400, detail="Cannot re-ingest file-based sources — original file is no longer stored")

    # Clear old vector chunks
    await delete_source_chunks(master_id, source_id)

    # Reset status
    source.status = IngestionStatus.pending
    source.error_message = None
    source.chunk_count = 0
    source.word_count = 0
    await db.commit()

    url = source.url

    async def _reingest():
        from app.database import AsyncSessionLocal
        try:
            ingested = await ingest_url(url)
            await _process_source(
                source_id=source_id,
                master_id=master_id,
                db_session_factory=AsyncSessionLocal,
                content=ingested,
            )
        except Exception as e:
            err_str = str(e)
            async with AsyncSessionLocal() as db2:
                result2 = await db2.execute(select(Source).where(Source.id == source_id))
                src = result2.scalar_one_or_none()
                if src:
                    src.status = IngestionStatus.failed
                    src.error_message = _user_friendly_error(err_str)
                    await db2.commit()

    background_tasks.add_task(_reingest)
    return {"source_id": source_id, "status": "processing", "message": f"Re-ingesting {url}"}


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(
    master_id: str,
    source_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Source).where(Source.id == source_id, Source.master_id == master_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    await delete_source_chunks(master_id, source_id)
    await db.delete(source)
    await db.commit()
