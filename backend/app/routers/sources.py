from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Source, IngestionStatus
from app.services.vector_store import get_source_chunks

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("/{source_id}/status")
async def get_source_status(source_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    return {
        "id": source.id,
        "status": source.status,
        "title": source.title,
        "chunk_count": source.chunk_count,
        "error_message": source.error_message,
    }


@router.get("/{source_id}/transcript")
async def get_source_transcript(source_id: str, db: AsyncSession = Depends(get_db)):
    """Return the full extracted text for a source, reassembled from chunks."""
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    if source.status != IngestionStatus.completed:
        raise HTTPException(status_code=400, detail="Source is not yet processed")

    chunks = await get_source_chunks(source.master_id, source_id)
    full_text = "\n\n".join(c["text"] for c in chunks)
    word_count = len(full_text.split()) if full_text else 0

    return {
        "source_id": source_id,
        "title": source.title,
        "url": source.url,
        "content_type": str(source.content_type),
        "author": source.author,
        "duration_seconds": source.duration_seconds,
        "word_count": word_count,
        "pages_estimate": round(word_count / 250, 1),
        "chunk_count": len(chunks),
        "text": full_text,
    }
