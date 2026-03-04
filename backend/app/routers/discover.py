from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import Master
from app.services.discovery import discover_person, list_channel_videos

# Errors that mean the source has no usable content — auto-delete instead of marking failed
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

router = APIRouter(prefix="/discover", tags=["discover"])


class DiscoverRequest(BaseModel):
    name: str
    context: Optional[str] = ""
    max_per_category: Optional[int] = 5


class ChannelRequest(BaseModel):
    channel_url: str


class BulkIngestRequest(BaseModel):
    master_id: str
    urls: list[str]


@router.post("/search")
async def search_person(body: DiscoverRequest):
    """Search for all public material on a person."""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    results = await discover_person(body.name.strip(), body.max_per_category, context=body.context or "")
    return results


@router.post("/channel-videos")
async def get_channel_videos(body: ChannelRequest):
    """List all videos in a YouTube channel or playlist URL."""
    url = body.channel_url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="channel_url is required")
    if "youtube.com" not in url and "youtu.be" not in url:
        raise HTTPException(status_code=400, detail="Only YouTube channel/playlist URLs are supported")
    try:
        videos = await list_channel_videos(url)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not read channel: {e}")
    return {"channel_url": url, "total": len(videos), "videos": videos}


@router.post("/ingest-bulk")
async def bulk_ingest(
    body: BulkIngestRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Queue multiple URLs for ingestion into a master."""
    result = await db.execute(select(Master).where(Master.id == body.master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    if len(body.urls) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 URLs per bulk ingest")

    import uuid
    from app.models import Source, IngestionStatus, ContentType
    from app.services.ingestion import detect_content_type, ingest_url
    from app.services.embeddings import chunk_text, embed_texts
    from app.services.vector_store import add_documents
    from app.database import AsyncSessionLocal

    queued = []
    for url in body.urls:
        content_type_str = detect_content_type(url)
        try:
            content_type = ContentType(content_type_str)
        except ValueError:
            content_type = ContentType.web

        source = Source(
            id=str(uuid.uuid4()),
            master_id=body.master_id,
            url=url,
            title=url,
            content_type=content_type,
            status=IngestionStatus.pending,
        )
        db.add(source)
        queued.append({"source_id": source.id, "url": url})

    await db.commit()

    async def _bulk_process():
        for item in queued:
            try:
                ingested = await ingest_url(item["url"])
                chunks = chunk_text(ingested.text)
                embeddings = await embed_texts(chunks)
                metadatas = [
                    {
                        "source_id": item["source_id"],
                        "master_id": body.master_id,
                        "title": ingested.title or item["url"],
                        "url": ingested.url or item["url"],
                        "content_type": ingested.content_type,
                        "chunk_index": i,
                    }
                    for i in range(len(chunks))
                ]
                await add_documents(body.master_id, item["source_id"], chunks, metadatas, embeddings)

                async with AsyncSessionLocal() as db2:
                    res = await db2.execute(select(Source).where(Source.id == item["source_id"]))
                    src = res.scalar_one_or_none()
                    if src:
                        src.status = IngestionStatus.completed
                        src.chunk_count = len(chunks)
                        src.word_count = len(ingested.text.split())
                        src.title = ingested.title or item["url"]
                        src.author = ingested.author
                        src.thumbnail_url = ingested.thumbnail_url
                        src.duration_seconds = ingested.duration_seconds
                        await db2.commit()
            except Exception as e:
                err_str = str(e)
                print(f"[BulkIngest] Failed {item['url']}: {err_str}")
                async with AsyncSessionLocal() as db2:
                    res = await db2.execute(select(Source).where(Source.id == item["source_id"]))
                    src = res.scalar_one_or_none()
                    if src:
                        if _is_empty_content_error(err_str):
                            # No usable content — silently remove, don't clutter the UI
                            await db2.delete(src)
                        else:
                            src.status = IngestionStatus.failed
                            src.error_message = err_str
                        await db2.commit()

    background_tasks.add_task(_bulk_process)

    return {
        "queued": len(queued),
        "message": f"Queued {len(queued)} sources for ingestion",
        "sources": queued,
    }
