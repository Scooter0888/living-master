from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import Master
from app.services.rag import query_master, get_answer_with_sources, get_anthropic_client
from app.services.vector_store import get_random_chunks

router = APIRouter(prefix="/masters/{master_id}/query", tags=["query"])


class QueryRequest(BaseModel):
    question: str
    stream: bool = True
    mode: str = "strict"   # "strict" | "contextual"


class FollowUpRequest(BaseModel):
    question: str
    answer: str


@router.post("/stream")
async def query_stream(
    master_id: str,
    body: QueryRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    async def event_stream():
        try:
            async for chunk in query_master(
                master_id, master.name, body.question,
                stream=True, mode=body.mode,
            ):
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/")
async def query_with_sources(
    master_id: str,
    body: QueryRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    response = await get_answer_with_sources(master_id, master.name, body.question)
    return response


@router.get("/suggest")
async def suggest_question(
    master_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Generate a probing question based on random chunks from the knowledge base."""
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    chunks = await get_random_chunks(master_id, n=10)
    if not chunks:
        return {"question": f"What would you most like to know about {master.name}?"}

    # Pick up to 5 random chunks for context
    import random
    sample = random.sample(chunks, min(5, len(chunks)))
    context = "\n---\n".join(sample)

    from app.config import get_settings as _get_settings
    _settings = _get_settings()

    client = get_anthropic_client()
    msg = await client.messages.create(
        model=_settings.chat_model if _settings.chat_model.startswith("claude-") else "claude-haiku-4-5-20251001",
        max_tokens=120,
        messages=[{
            "role": "user",
            "content": (
                f"Based on these excerpts from {master.name}'s content, generate ONE specific, "
                f"thought-provoking question that a curious person would genuinely want to ask {master.name}. "
                f"The question must be directly answerable from the content shown.\n\n"
                f"Content excerpts:\n{context}\n\n"
                f"Respond with ONLY the question text. No quotes, no preamble."
            ),
        }],
    )
    question = msg.content[0].text.strip().strip('"').strip("'")
    return {"question": question}


@router.post("/follow-ups")
async def suggest_follow_ups(
    master_id: str,
    body: FollowUpRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate 3 context-aware follow-up questions based on the conversation."""
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    from app.config import get_settings as _get_settings
    _settings = _get_settings()

    client = get_anthropic_client()
    msg = await client.messages.create(
        model=_settings.chat_model if _settings.chat_model.startswith("claude-") else "claude-haiku-4-5-20251001",
        max_tokens=200,
        messages=[{
            "role": "user",
            "content": (
                f"A user just asked {master.name} a question and got an answer.\n\n"
                f"Question: {body.question}\n\n"
                f"Answer (truncated): {body.answer[:600]}\n\n"
                f"Generate exactly 3 short follow-up questions the user might want to ask next. "
                f"They should dig deeper into the topic, explore related areas, or clarify points from the answer. "
                f"Each question should be 5-12 words.\n\n"
                f"Respond with ONLY the 3 questions, one per line. No numbering, no quotes, no preamble."
            ),
        }],
    )
    lines = [l.strip() for l in msg.content[0].text.strip().split("\n") if l.strip()]
    return {"questions": lines[:3]}
