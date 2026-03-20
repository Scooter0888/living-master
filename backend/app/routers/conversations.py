import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import Master, Conversation, ConversationMessage

router = APIRouter(prefix="/masters/{master_id}/conversations", tags=["conversations"])


class SaveConversationRequest(BaseModel):
    title: Optional[str] = None
    messages: list[dict]  # [{role, content, sources?}]


class UpdateConversationRequest(BaseModel):
    title: str


@router.get("/")
async def list_conversations(
    master_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.master_id == master_id)
        .order_by(Conversation.updated_at.desc())
    )
    convos = result.scalars().all()
    return [
        {
            "id": c.id,
            "title": c.title,
            "message_count": len(c.messages) if c.messages else 0,
            "created_at": c.created_at.isoformat(),
            "updated_at": c.updated_at.isoformat(),
        }
        for c in convos
    ]


@router.post("/")
async def save_conversation(
    master_id: str,
    body: SaveConversationRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Master).where(Master.id == master_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Master not found")

    if not body.messages:
        raise HTTPException(status_code=400, detail="No messages to save")

    # Auto-generate title from first user message
    title = body.title
    if not title:
        first_user = next((m for m in body.messages if m.get("role") == "user"), None)
        title = (first_user["content"][:60] + "…") if first_user else "Conversation"

    convo = Conversation(master_id=master_id, title=title)
    db.add(convo)
    await db.flush()

    for msg in body.messages:
        sources_json = json.dumps(msg["sources"]) if msg.get("sources") else None
        db_msg = ConversationMessage(
            conversation_id=convo.id,
            role=msg["role"],
            content=msg["content"],
            sources_json=sources_json,
        )
        db.add(db_msg)

    await db.commit()
    return {"id": convo.id, "title": convo.title}


@router.get("/{conversation_id}")
async def get_conversation(
    master_id: str,
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conversation_id, Conversation.master_id == master_id)
    )
    convo = result.scalar_one_or_none()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {
        "id": convo.id,
        "title": convo.title,
        "created_at": convo.created_at.isoformat(),
        "messages": [
            {
                "role": m.role,
                "content": m.content,
                "sources": json.loads(m.sources_json) if m.sources_json else None,
            }
            for m in convo.messages
        ],
    }


@router.patch("/{conversation_id}")
async def update_conversation(
    master_id: str,
    conversation_id: str,
    body: UpdateConversationRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id, Conversation.master_id == master_id)
    )
    convo = result.scalar_one_or_none()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")

    convo.title = body.title
    await db.commit()
    return {"id": convo.id, "title": convo.title}


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    master_id: str,
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id, Conversation.master_id == master_id)
    )
    convo = result.scalar_one_or_none()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")

    await db.delete(convo)
    await db.commit()


@router.get("/{conversation_id}/export")
async def export_conversation(
    master_id: str,
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Export conversation as JSON for download."""
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conversation_id, Conversation.master_id == master_id)
    )
    convo = result.scalar_one_or_none()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")

    master_result = await db.execute(select(Master).where(Master.id == master_id))
    master = master_result.scalar_one_or_none()

    return {
        "title": convo.title,
        "master": master.name if master else master_id,
        "created_at": convo.created_at.isoformat(),
        "messages": [
            {
                "role": m.role,
                "content": m.content,
                "sources": json.loads(m.sources_json) if m.sources_json else None,
            }
            for m in convo.messages
        ],
    }
