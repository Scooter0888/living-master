"""
Media router: photo upload/list/delete/update-caption for a master.
Photos served as static files at /static/photos/{master_id}/{filename}.
"""
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import Master, Photo
from app.config import get_settings

router = APIRouter(prefix="/masters/{master_id}/media", tags=["media"])

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _photo_url(master_id: str, filename: str) -> str:
    return f"/static/photos/{master_id}/{filename}"


def _photo_response(photo: Photo) -> dict:
    return {
        "id": photo.id,
        "filename": photo.filename,
        "caption": photo.caption,
        "url": _photo_url(photo.master_id, photo.filename),
        "created_at": photo.created_at.isoformat() if photo.created_at else None,
    }


@router.post("/photos", status_code=201)
async def upload_photo(
    master_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    original_filename = file.filename or "photo"
    ext = os.path.splitext(original_filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type. Allowed: {', '.join(ALLOWED_IMAGE_EXTS)}"
        )

    settings = get_settings()
    photo_id = str(uuid.uuid4())
    save_filename = f"{photo_id}{ext}"
    master_photos_dir = os.path.join(settings.photos_path, master_id)
    os.makedirs(master_photos_dir, exist_ok=True)
    save_path = os.path.join(master_photos_dir, save_filename)

    content = await file.read()
    with open(save_path, "wb") as f_out:
        f_out.write(content)

    photo = Photo(
        id=photo_id,
        master_id=master_id,
        filename=save_filename,
        caption=None,
        file_path=save_path,
    )
    db.add(photo)
    await db.commit()
    await db.refresh(photo)

    return _photo_response(photo)


@router.get("/photos")
async def list_photos(master_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Master).where(Master.id == master_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Master not found")

    result = await db.execute(
        select(Photo).where(Photo.master_id == master_id).order_by(Photo.created_at)
    )
    photos = result.scalars().all()
    return [_photo_response(p) for p in photos]


@router.delete("/photos/{photo_id}", status_code=204)
async def delete_photo(master_id: str, photo_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Photo).where(Photo.id == photo_id, Photo.master_id == master_id)
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Delete from disk
    if photo.file_path and os.path.exists(photo.file_path):
        os.unlink(photo.file_path)

    await db.delete(photo)
    await db.commit()


class CaptionUpdate(BaseModel):
    caption: Optional[str] = None


@router.patch("/photos/{photo_id}")
async def update_caption(
    master_id: str,
    photo_id: str,
    body: CaptionUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Photo).where(Photo.id == photo_id, Photo.master_id == master_id)
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    photo.caption = body.caption
    await db.commit()
    await db.refresh(photo)
    return _photo_response(photo)
