"""
Voice router: voice picker, ElevenLabs cloning (from uploads OR YouTube), TTS synthesis, speaker ID.
"""
import os
import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List

from app.database import get_db
from app.models import Master, Source, IngestionStatus
from app.config import get_settings
from app.services.voice import (
    EDGE_VOICE_CATALOG,
    EDGE_PREFIX,
    LOCAL_PREFIX,
    _coqui_available,
    _assign_edge_voice,
    _synthesize_edge,
    synthesize_speech,
    get_audio_content_type,
)

router = APIRouter(prefix="/masters/{master_id}/voice", tags=["voice"])


class CloneRequest(BaseModel):
    source_ids: Optional[List[str]] = None  # optional filter to specific sources


class SynthesizeRequest(BaseModel):
    text: str


class SelectVoiceRequest(BaseModel):
    voice_id: str   # e.g. "edge:en-US-GuyNeural"


class PreviewRequest(BaseModel):
    voice_name: str   # e.g. "en-US-GuyNeural"
    text: str = "Every action we take, however small, carries the full weight of our attention."


class IdentifySpeakerRequest(BaseModel):
    source_id: str
    master_speaker: str


# ---------------------------------------------------------------------------
# Voice options catalog
# ---------------------------------------------------------------------------

@router.get("/voices")
async def list_voices(_master_id: str = None, master_id: str = None):
    """Return the edge-tts voice catalog for the voice picker UI."""
    return {"voices": EDGE_VOICE_CATALOG}


@router.post("/preview")
async def preview_voice(master_id: str, body: PreviewRequest):
    """Synthesize a short sample with any edge-tts voice — for the voice picker preview."""
    try:
        audio_bytes = await _synthesize_edge(body.voice_name, body.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview failed: {e}")
    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=preview.mp3"},
    )


@router.post("/select")
async def select_voice(
    master_id: str,
    body: SelectVoiceRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Instantly set the master's voice to an edge-tts preset.
    No cloning required — voice is ready immediately.
    """
    # Validate it's an edge-tts voice ID
    voice_id = body.voice_id
    if not voice_id.startswith(EDGE_PREFIX):
        raise HTTPException(status_code=400, detail="Only edge: voice IDs accepted by this endpoint")

    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    master.voice_id = voice_id
    master.voice_status = "ready"
    await db.commit()

    return {"status": "ready", "voice_id": voice_id}


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

@router.get("/status")
async def get_voice_status(master_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")
    return {
        "voice_status": master.voice_status or "none",
        "voice_id": master.voice_id,
    }


# ---------------------------------------------------------------------------
# Clone
# ---------------------------------------------------------------------------

@router.post("/clone", status_code=202)
async def clone_voice(
    master_id: str,
    body: CloneRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Clone the master's voice using ElevenLabs.
    Audio sources tried in order:
      1. Uploaded audio/video files in uploads/
      2. Short clips downloaded from YouTube sources in the knowledge base
    Requires ELEVENLABS_API_KEY in .env.
    """
    settings = get_settings()

    if not settings.elevenlabs_api_key:
        raise HTTPException(
            status_code=422,
            detail=(
                "ELEVENLABS_API_KEY is not configured. Add it to backend/.env to enable voice cloning. "
                "Use the 'Select Voice' tab for a free preset voice."
            ),
        )

    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    # Gather uploaded audio/video files
    uploads_dir = settings.uploads_path
    AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"}
    VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".vob", ".m4v"}

    upload_audio_paths: list[str] = []
    if os.path.isdir(uploads_dir):
        for fn in sorted(os.listdir(uploads_dir)):
            ext = os.path.splitext(fn)[1].lower()
            if ext in AUDIO_EXTS or ext in VIDEO_EXTS:
                upload_audio_paths.append(os.path.join(uploads_dir, fn))

    # Gather YouTube source URLs as fallback (will be downloaded in background)
    yt_result = await db.execute(
        select(Source).where(
            Source.master_id == master_id,
            Source.status == IngestionStatus.completed,
            Source.content_type.in_(["youtube"]),
        ).limit(5)
    )
    yt_sources = yt_result.scalars().all()
    yt_urls = [s.url for s in yt_sources if s.url]

    if not upload_audio_paths and not yt_urls:
        raise HTTPException(
            status_code=422,
            detail=(
                "No audio sources found. "
                "Upload an audio/video file, or add YouTube sources to the knowledge base first."
            ),
        )

    master.voice_status = "cloning"
    await db.commit()

    _master_name = master.name
    _master_id = master_id

    async def _do_clone():
        from app.database import AsyncSessionLocal
        from app.services.voice import clone_voice as _clone_voice, download_youtube_voice_samples

        async with AsyncSessionLocal() as db2:
            result2 = await db2.execute(select(Master).where(Master.id == _master_id))
            m = result2.scalar_one_or_none()
            if not m:
                return
            try:
                audio_paths = list(upload_audio_paths)  # start with uploaded files

                # If no uploads, download from YouTube
                if not audio_paths and yt_urls:
                    print(f"[Voice Clone] No uploads found — downloading clips from {len(yt_urls)} YouTube sources")
                    yt_clips = await download_youtube_voice_samples(yt_urls, _master_id)
                    audio_paths.extend(yt_clips)

                if not audio_paths:
                    raise ValueError("Could not obtain audio from any source")

                voice_id = await _clone_voice(_master_name, audio_paths)
                m.voice_id = voice_id
                m.voice_status = "ready"
                print(f"[Voice Clone] Success — voice_id={voice_id}")
            except Exception as e:
                print(f"[Voice Clone] Failed: {e}")
                m.voice_status = "none"
            await db2.commit()

    background_tasks.add_task(_do_clone)

    source_desc = "uploaded files" if upload_audio_paths else f"{len(yt_urls)} YouTube sources"
    return {"status": "cloning", "message": f"Cloning voice from {source_desc} via ElevenLabs"}


# ---------------------------------------------------------------------------
# Synthesize
# ---------------------------------------------------------------------------

@router.post("/synthesize")
async def synthesize_speech_endpoint(
    master_id: str,
    body: SynthesizeRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Master).where(Master.id == master_id))
    master = result.scalar_one_or_none()
    if not master:
        raise HTTPException(status_code=404, detail="Master not found")

    if not master.voice_id:
        raise HTTPException(
            status_code=422,
            detail="No voice set up yet. Go to the Media tab and select or clone a voice first."
        )

    try:
        audio_bytes = await synthesize_speech(master.voice_id, body.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {e}")

    content_type = get_audio_content_type(master.voice_id)
    ext = "wav" if "wav" in content_type else "mp3"
    return Response(
        content=audio_bytes,
        media_type=content_type,
        headers={"Content-Disposition": f"inline; filename=speech.{ext}"},
    )


# ---------------------------------------------------------------------------
# Identify speaker (diarization post-processing)
# ---------------------------------------------------------------------------

@router.post("/identify-speaker")
async def identify_speaker(
    master_id: str,
    body: IdentifySpeakerRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Source).where(Source.id == body.source_id, Source.master_id == master_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    source.speaker_label = body.master_speaker
    source.status = IngestionStatus.processing
    await db.commit()

    async def _reindex():
        from app.database import AsyncSessionLocal
        from app.services.vector_store import delete_source_chunks, add_documents, get_source_chunks
        from app.services.embeddings import chunk_text, embed_texts

        async with AsyncSessionLocal() as db2:
            result2 = await db2.execute(select(Source).where(Source.id == body.source_id))
            src = result2.scalar_one_or_none()
            if not src:
                return
            try:
                existing = await get_source_chunks(master_id, body.source_id)
                if not existing:
                    src.status = IngestionStatus.completed
                    await db2.commit()
                    return

                master_chunks = [
                    c for c in existing
                    if c.get("speaker") == body.master_speaker or not c.get("speaker")
                ]
                if not master_chunks:
                    master_chunks = existing

                text = " ".join(c["text"] for c in master_chunks)
                chunks = chunk_text(text)
                if not chunks:
                    src.status = IngestionStatus.completed
                    await db2.commit()
                    return

                embeddings = await embed_texts(chunks)
                metadatas = [
                    {
                        "source_id": body.source_id,
                        "master_id": master_id,
                        "title": src.title or "Untitled",
                        "url": src.url or "",
                        "content_type": src.content_type.value if hasattr(src.content_type, "value") else str(src.content_type),
                        "chunk_index": i,
                        "speaker": body.master_speaker,
                    }
                    for i in range(len(chunks))
                ]
                await delete_source_chunks(master_id, body.source_id)
                await add_documents(master_id, body.source_id, chunks, metadatas, embeddings)
                src.status = IngestionStatus.completed
                src.chunk_count = len(chunks)
            except Exception as e:
                print(f"[IdentifySpeaker] Reindex failed: {e}")
                src.status = IngestionStatus.completed
            await db2.commit()

    background_tasks.add_task(_reindex)
    return {"status": "processing", "message": "Re-indexing with master speaker only"}
