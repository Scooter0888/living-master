from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from pydantic import BaseModel, field_validator
from typing import Optional
import uuid
import os
import shutil

from app.database import get_db
from app.models import Master, Source, IngestionStatus
from app.services.vector_store import delete_master_collection

router = APIRouter(prefix="/masters", tags=["masters"])


class MasterCreate(BaseModel):
    name: str
    description: Optional[str] = None
    avatar_color: Optional[str] = "#6366f1"

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be empty")
        if len(v) > 120:
            raise ValueError("Name must be 120 characters or fewer")
        return v


class MasterUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    avatar_color: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Name cannot be empty")
            if len(v) > 120:
                raise ValueError("Name must be 120 characters or fewer")
        return v


def _serialize_master(master: Master, source_count: int = 0, total_chunks: int = 0) -> dict:
    from app.config import get_settings
    settings = get_settings()
    profile_photo_url = None
    if master.profile_photo_path and os.path.exists(master.profile_photo_path):
        rel = os.path.relpath(master.profile_photo_path, settings.photos_path)
        profile_photo_url = f"/static/photos/{rel}"
    return {
        "id": master.id,
        "name": master.name,
        "description": master.description,
        "avatar_color": master.avatar_color,
        "profile_photo_url": profile_photo_url,
        "source_count": source_count,
        "total_chunks": total_chunks,
        "created_at": master.created_at.isoformat() if master.created_at else None,
        "updated_at": master.updated_at.isoformat() if master.updated_at else None,
        "voice_id": master.voice_id,
        "voice_status": master.voice_status or "none",
    }


@router.get("/")
async def list_masters(db: AsyncSession = Depends(get_db)):
    # Single query with LEFT JOIN — avoids N+1 per master
    stmt = (
        select(
            Master,
            func.count(
                case((Source.status == IngestionStatus.completed, Source.id), else_=None)
            ).label("source_count"),
            func.coalesce(
                func.sum(
                    case((Source.status == IngestionStatus.completed, Source.chunk_count), else_=None)
                ),
                0,
            ).label("total_chunks"),
        )
        .outerjoin(Source, Source.master_id == Master.id)
        .group_by(Master.id)
        .order_by(Master.created_at.desc())
    )
    result = await db.execute(stmt)
    rows = result.all()
    return [_serialize_master(row.Master, row.source_count, row.total_chunks) for row in rows]


@router.post("/", status_code=201)
async def create_master(body: MasterCreate, db: AsyncSession = Depends(get_db)):
    master = Master(
        id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        avatar_color=body.avatar_color or "#6366f1",
    )
    db.add(master)
    await db.commit()
    await db.refresh(master)
    return _serialize_master(master)


@router.get("/{master_id}")
async def get_master(master_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    sources_result = await db.execute(
        select(Source).where(Source.master_id == master_id).order_by(Source.created_at.desc())
    )
    sources = sources_result.scalars().all()

    source_count = len([s for s in sources if s.status == IngestionStatus.completed])
    total_chunks = sum(s.chunk_count or 0 for s in sources)

    return {
        **_serialize_master(master, source_count, total_chunks),
        "sources": [_serialize_source(s) for s in sources],
    }


@router.patch("/{master_id}")
async def update_master(master_id: str, body: MasterUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    if body.name is not None:
        master.name = body.name
    if body.description is not None:
        master.description = body.description
    if body.avatar_color is not None:
        master.avatar_color = body.avatar_color

    await db.commit()
    await db.refresh(master)
    return _serialize_master(master)


@router.post("/{master_id}/profile-photo")
async def upload_profile_photo(
    master_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a profile photo for the master (replaces previous one)."""
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    from app.config import get_settings
    settings = get_settings()

    ext = os.path.splitext(file.filename or "photo.jpg")[1].lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        raise HTTPException(status_code=400, detail="Only JPEG/PNG/WEBP/GIF allowed")

    master_photo_dir = os.path.join(settings.photos_path, master_id)
    os.makedirs(master_photo_dir, exist_ok=True)

    # Delete old profile photo if any
    if master.profile_photo_path and os.path.exists(master.profile_photo_path):
        os.unlink(master.profile_photo_path)

    dest = os.path.join(master_photo_dir, f"profile{ext}")
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    master.profile_photo_path = dest
    await db.commit()
    await db.refresh(master)
    return _serialize_master(master)


@router.delete("/{master_id}/profile-photo", status_code=204)
async def delete_profile_photo(
    master_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    if master.profile_photo_path and os.path.exists(master.profile_photo_path):
        os.unlink(master.profile_photo_path)
    master.profile_photo_path = None
    await db.commit()


@router.delete("/{master_id}", status_code=204)
async def delete_master(master_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    await delete_master_collection(master_id)
    await db.delete(master)
    await db.commit()


def _serialize_source(source: Source) -> dict:
    import json as _json
    speaker_samples = None
    if source.speaker_samples_json:
        try:
            speaker_samples = _json.loads(source.speaker_samples_json)
        except Exception:
            pass
    return {
        "id": source.id,
        "master_id": source.master_id,
        "url": source.url,
        "title": source.title,
        "content_type": source.content_type,
        "status": source.status,
        "error_message": source.error_message,
        "chunk_count": source.chunk_count,
        "duration_seconds": source.duration_seconds,
        "thumbnail_url": source.thumbnail_url,
        "author": source.author,
        "created_at": source.created_at.isoformat() if source.created_at else None,
        "has_diarization": source.has_diarization or False,
        "speaker_count": source.speaker_count,
        "speaker_label": source.speaker_label,
        "has_movement_analysis": source.has_movement_analysis or False,
        "speaker_samples": speaker_samples,
    }
