import os
import uuid
import json
import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form
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


async def _process_source(source_id: str, master_id: str, db_session_factory, content=None, file_path: Optional[str] = None, original_filename: Optional[str] = None):
    """Background task: extract text → chunk → embed → store."""
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Source).where(Source.id == source_id))
        source = result.scalar_one_or_none()
        if not source:
            return

        try:
            source.status = IngestionStatus.processing
            await db.commit()

            # Ingest content
            if file_path and original_filename:
                ingested = await ingest_file(file_path, original_filename)
            else:
                ingested = content

            # Chunk
            chunks = chunk_text(ingested.text)
            if not chunks:
                raise ValueError("No text could be extracted from this source")

            # Embed
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
            source.chunk_count = len(chunks) + len(movement_chunks)
            source.word_count = len(ingested.text.split())
            source.title = ingested.title or source.title
            source.author = ingested.author
            source.thumbnail_url = ingested.thumbnail_url
            source.duration_seconds = ingested.duration_seconds
            await db.commit()

        except Exception as e:
            err_str = str(e)
            print(f"[Ingest] Error processing source {source_id}: {err_str}")
            if _is_empty_content_error(err_str):
                await db.delete(source)
            else:
                source.status = IngestionStatus.failed
                source.error_message = err_str
            await db.commit()
        finally:
            # Delete uploaded file — movement analysis already ran during ingestion
            if file_path and os.path.exists(file_path):
                os.unlink(file_path)


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

    # Reject duplicate URLs for the same master
    existing = await db.execute(
        select(Source).where(Source.master_id == master_id, Source.url == body.url)
    )
    if existing.scalar_one_or_none():
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
                        src.error_message = err_str
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
    )

    return {
        "source_id": source.id,
        "status": "processing",
        "message": f"Processing {original_filename}",
    }


class IngestLocalPathRequest(BaseModel):
    path: str


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
                ingested = await ingest_dvd_folder(path)
            else:
                ingested = await ingest_file(path, display_title)
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
                        src.error_message = err_str
                    await db2.commit()

    background_tasks.add_task(_ingest_local)

    return {
        "source_id": source.id,
        "status": "processing",
        "message": f"Processing {display_title}",
    }


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
                    src.error_message = err_str
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
