"""
Export router: knowledge stats + AI-generated book/knowledge-base compilation + PDF + movement.
"""
import os
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List

from app.database import get_db
from app.models import Master, Source, IngestionStatus, Photo
from app.services.vector_store import get_all_chunks
from app.config import get_settings

router = APIRouter(prefix="/masters/{master_id}/export", tags=["export"])


class BookRequest(BaseModel):
    topic: Optional[str] = None


class PDFRequest(BaseModel):
    title: str
    content: str
    include_photos: bool = True


@router.get("/stats")
async def get_knowledge_stats(master_id: str, db: AsyncSession = Depends(get_db)):
    """Return metrics about the entire knowledge base."""
    result = await db.execute(
        select(Master).where(Master.id == master_id).options(selectinload(Master.sources))
    )
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    completed = [s for s in master.sources if s.status == IngestionStatus.completed]

    # Compute live word counts from Chroma chunks (handles sources ingested before word_count column existed)
    all_chunks = await get_all_chunks(master_id, limit=5000)
    source_word_counts: dict[str, int] = {}
    for chunk in all_chunks:
        sid = chunk["source_id"]
        source_word_counts[sid] = source_word_counts.get(sid, 0) + len(chunk["text"].split())

    total_words = sum(source_word_counts.values())
    total_chunks = sum(s.chunk_count or 0 for s in completed)

    # Per content-type summary
    by_type: dict[str, dict] = {}
    for s in completed:
        ct = s.content_type.value if hasattr(s.content_type, 'value') else str(s.content_type)
        if ct not in by_type:
            by_type[ct] = {"count": 0, "words": 0}
        by_type[ct]["count"] += 1
        by_type[ct]["words"] += source_word_counts.get(s.id, s.word_count or 0)

    # Per-source detail, sorted by word count descending
    source_details = []
    for s in sorted(completed, key=lambda x: source_word_counts.get(x.id, x.word_count or 0), reverse=True):
        wc = source_word_counts.get(s.id, s.word_count or 0)
        source_details.append({
            "id": s.id,
            "title": s.title,
            "url": s.url,
            "content_type": s.content_type.value if hasattr(s.content_type, 'value') else str(s.content_type),
            "author": s.author,
            "word_count": wc,
            "pages_estimate": round(wc / 250, 1),
            "chunk_count": s.chunk_count or 0,
            "duration_seconds": s.duration_seconds,
        })

    return {
        "master_name": master.name,
        "total_sources": len(completed),
        "total_chunks": total_chunks,
        "total_words": total_words,
        "estimated_pages": round(total_words / 250),
        "by_type": by_type,
        "sources": source_details,
    }


@router.post("/book/stream")
async def generate_book_stream(
    master_id: str,
    body: BookRequest,
    db: AsyncSession = Depends(get_db),
):
    """Stream a book-format compilation of the entire knowledge base, organized by Claude."""
    result = await db.execute(
        select(Master).where(Master.id == master_id)
    )
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    settings = get_settings()

    # Gather all content (cap to ~100k chars to stay within Claude's context)
    all_chunks = await get_all_chunks(master_id, limit=2000)
    if not all_chunks:
        async def _empty():
            yield "data: [ERROR] No content found in this knowledge base\n\n"
        return StreamingResponse(_empty(), media_type="text/event-stream")

    content_parts: list[str] = []
    total_chars = 0
    MAX_CHARS = 90000
    current_source = ""
    for chunk in all_chunks:
        if chunk["source_id"] != current_source:
            current_source = chunk["source_id"]
            header = f"\n### [{chunk['title']} — {chunk['content_type']}]\n"
            content_parts.append(header)
            total_chars += len(header)
        if total_chars >= MAX_CHARS:
            content_parts.append("\n[... additional content omitted for length ...]")
            break
        content_parts.append(chunk["text"])
        total_chars += len(chunk["text"])

    full_content = "\n".join(content_parts)

    topic_instruction = (
        f"Focus the book specifically on the topic: **{body.topic}**. Draw only from content relevant to this theme."
        if body.topic
        else "Cover all the major themes, philosophies, and insights present across the knowledge base."
    )

    system_prompt = f"""You are a gifted author, editor, and biographer. You have been given the complete raw knowledge base of {master.name} — transcripts, interviews, articles, and writings. Your task is to compile this into a beautifully written, engaging book that a reader would genuinely want to finish.

Your role has two dimensions, and understanding the distinction is everything:

**As an AUTHOR** (your writing, your craft):
- Write with full literary flair — vivid openings, compelling narrative, emotional resonance, varied rhythm
- Set scenes, explain context, build tension and release, draw out the significance of what the master says
- Write authoritative, engaging chapter introductions and conclusions
- Create flowing connective prose that gives readers the "why" behind the master's words
- This is where your craft lives — make it beautiful

**As an ATTRIBUTOR** (the master's words — strict rules):
- Everything specific attributed to {master.name} — their teachings, their quotes, their stated beliefs, any events or facts about them — MUST come directly from the provided source material
- Direct quotes in > blockquotes MUST be verbatim from the source. Never paraphrase and present as a quote
- Do not invent events, biographical details, or opinions not documented in the source
- If a topic isn't in the source material, omit it — don't speculate

The test: your prose can be entirely original; but every specific claim about what {master.name} thinks, said, did, or believes must be traceable to a real source chunk.

Movement/physical context chunks — e.g. "[2:15] {master.name} says: '...' — At this moment: [physical description]" — are real documented content. Weave the physical dimension into your narrative; it's one of the most vivid elements available to you.

Structure your output in clean Markdown:
1. **Book title** (H1) — evocative, resonant with the material
2. **Introduction** — 3–4 paragraphs that draw the reader in: who is {master.name}, why does this material matter, what will this book reveal
3. **6–8 Chapters**, each with:
   - Chapter number and evocative title (H2)
   - A compelling opening that sets the theme — your best writing
   - The master's words as > blockquotes, generously used
   - Rich narrative between quotes: context, significance, how ideas connect
   - A resonant closing paragraph that lands the chapter's central insight
4. **Conclusion** — a memorable close that ties the whole together

{topic_instruction}

Write something a reader would be reluctant to put down. The master's documented words are the substance; your craft makes them sing."""

    user_message = f"Here is the complete knowledge base:\n\n{full_content}\n\n---\n\nNow write the book."

    async def generate():
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        try:
            with client.messages.stream(
                model=settings.claude_model,
                max_tokens=8000,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            ) as stream:
                for text in stream.text_stream:
                    # Escape newlines so each SSE data line is valid
                    escaped = text.replace("\\", "\\\\").replace("\n", "\\n")
                    yield f"data: {escaped}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/book/pdf")
async def download_book_pdf(
    master_id: str,
    body: PDFRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate and return a print-ready PDF of the book content."""
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    photo_paths = []
    if body.include_photos:
        photos_result = await db.execute(
            select(Photo).where(Photo.master_id == master_id).order_by(Photo.created_at)
        )
        photos = photos_result.scalars().all()
        photo_paths = [
            {"path": p.file_path, "caption": p.caption or ""}
            for p in photos
            if p.file_path and os.path.exists(p.file_path)
        ]

    try:
        from app.services.pdf_export import generate_pdf
        pdf_bytes = generate_pdf(
            title=body.title,
            author=master.name,
            content_md=body.content,
            photo_paths=photo_paths,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")

    safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in body.title)[:80]
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )


@router.post("/sources/{source_id}/analyse-movements", status_code=202)
async def analyse_movements(
    master_id: str,
    source_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Trigger movement analysis for a video source using Claude Vision."""
    result = await db.execute(
        select(Source).where(Source.id == source_id, Source.master_id == master_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    if source.content_type.value not in ("video", "youtube"):
        raise HTTPException(status_code=400, detail="Movement analysis only supported for video sources")

    result_master = await db.execute(select(Master).where(Master.id == master_id))
    master = result_master.scalar_one_or_none()

    # Grab video path and transcript segments before background task
    video_path = source.video_path
    raw_segments_json = source.transcript_segments_json

    if not video_path or not os.path.exists(video_path):
        raise HTTPException(
            status_code=422,
            detail="Video file not found on disk. Re-upload the video to enable movement analysis."
        )

    async def _analyse():
        import json as _json
        from app.database import AsyncSessionLocal
        from app.services.movement import analyse_video_movements
        from app.services.embeddings import embed_texts
        from app.services.vector_store import add_documents

        # Load stored transcript segments for speech+vision fusion
        transcript_segments = []
        if raw_segments_json:
            try:
                transcript_segments = _json.loads(raw_segments_json)
            except Exception:
                pass

        async with AsyncSessionLocal() as db2:
            result2 = await db2.execute(select(Source).where(Source.id == source_id))
            src = result2.scalar_one_or_none()
            if not src:
                return
            try:
                master_name = master.name if master else "Unknown"
                movements = await analyse_video_movements(
                    video_path,
                    master_name,
                    transcript_segments=transcript_segments,
                )
                if movements:
                    texts = [m["text"] for m in movements]
                    embeddings = await embed_texts(texts)
                    metadatas = [
                        {
                            "source_id": source_id,
                            "master_id": master_id,
                            "title": f"{src.title} — Movement Analysis",
                            "url": src.url or "",
                            "content_type": "movement_analysis",
                            "chunk_index": m["chunk_index"],
                            "timestamp": m["timestamp"],
                        }
                        for m in movements
                    ]
                    await add_documents(master_id, f"{source_id}-movements", texts, metadatas, embeddings)
                    src.has_movement_analysis = True
                    src.chunk_count = (src.chunk_count or 0) + len(movements)
                    await db2.commit()
                    print(f"[Movement] Added {len(movements)} fused speech+vision chunks for source {source_id}")
            except Exception as e:
                print(f"[Movement] Analysis failed: {e}")

    background_tasks.add_task(_analyse)
    return {"status": "processing", "message": "Movement analysis started — speech and vision will be fused"}


@router.get("/topics/stream")
async def discover_topics_stream(
    master_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Stream an AI-identified list of themes and topics present in the knowledge base."""
    result = await db.execute(
        select(Master).where(Master.id == master_id)
    )
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    settings = get_settings()

    all_chunks = await get_all_chunks(master_id, limit=1500)
    if not all_chunks:
        async def _empty():
            yield "data: [ERROR] No content found in this knowledge base\n\n"
        return StreamingResponse(_empty(), media_type="text/event-stream")

    # Use a sample of content to identify topics (no need for the full corpus)
    sample_parts: list[str] = []
    total_chars = 0
    MAX_CHARS = 60000
    current_source = ""
    for chunk in all_chunks:
        if chunk["source_id"] != current_source:
            current_source = chunk["source_id"]
            header = f"\n### [{chunk['title']}]\n"
            sample_parts.append(header)
            total_chars += len(header)
        if total_chars >= MAX_CHARS:
            break
        sample_parts.append(chunk["text"])
        total_chars += len(chunk["text"])

    sample_content = "\n".join(sample_parts)

    system_prompt = f"""You are a knowledge analyst. You have been given a sample of the knowledge base of {master.name}.

Your task: identify the 6–10 most significant, distinct themes and topics present in this material.

Output ONLY a JSON array in this exact format — no prose before or after:
[
  {{"topic": "Short Topic Name", "description": "One sentence describing what this theme covers and why it matters.", "keywords": ["keyword1", "keyword2", "keyword3"]}},
  ...
]

Topics should be specific enough to be useful as book chapter themes. Avoid generic labels like "General Teaching"."""

    user_message = f"Here is the knowledge base sample:\n\n{sample_content}\n\n---\n\nIdentify the main themes. Output only the JSON array."

    async def generate():
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        try:
            with client.messages.stream(
                model=settings.claude_model,
                max_tokens=1500,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            ) as stream:
                for text in stream.text_stream:
                    escaped = text.replace("\\", "\\\\").replace("\n", "\\n")
                    yield f"data: {escaped}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
