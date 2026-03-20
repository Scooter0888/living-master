from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models import Source, IngestionStatus
from app.services.vector_store import get_source_chunks, update_chunk
from app.services.embeddings import embed_texts

router = APIRouter(prefix="/sources", tags=["sources"])


SUPPORTED_LANGUAGES = {
    "English": "English",
    "Spanish": "Spanish",
    "French": "French",
    "German": "German",
    "Portuguese": "Portuguese",
    "Italian": "Italian",
    "Dutch": "Dutch",
    "Russian": "Russian",
    "Chinese (Simplified)": "Simplified Chinese",
    "Chinese (Traditional)": "Traditional Chinese",
    "Japanese": "Japanese",
    "Korean": "Korean",
    "Arabic": "Arabic",
    "Hindi": "Hindi",
    "Turkish": "Turkish",
    "Polish": "Polish",
    "Ukrainian": "Ukrainian",
    "Swedish": "Swedish",
    "Norwegian": "Norwegian",
    "Danish": "Danish",
}


class UpdateChunkRequest(BaseModel):
    text: str


class TranslateRequest(BaseModel):
    target_language: str  # must be a key in SUPPORTED_LANGUAGES


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
    """Return the full extracted text and speaker-segmented transcript for a source."""
    import json as _json
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    if source.status != IngestionStatus.completed:
        raise HTTPException(status_code=400, detail="Source is not yet processed")

    chunks = await get_source_chunks(source.master_id, source_id)
    full_text = "\n\n".join(c["text"] for c in chunks)
    word_count = len(full_text.split()) if full_text else 0

    # Parse stored timestamped segments (set during transcription/diarization)
    segments = []
    if source.transcript_segments_json:
        try:
            segments = _json.loads(source.transcript_segments_json)
        except Exception:
            pass

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
        # Speaker-level data
        "segments": segments,           # [{text, start, end, speaker?}]
        "speaker_label": source.speaker_label,    # master's speaker ID e.g. "SPEAKER_00"
        "has_diarization": source.has_diarization or False,
    }


@router.get("/{source_id}/chunks")
async def get_chunks(source_id: str, db: AsyncSession = Depends(get_db)):
    """Return all indexed chunks for a source, ordered by chunk_index."""
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    chunks = await get_source_chunks(source.master_id, source_id)
    return {"source_id": source_id, "chunks": chunks}


@router.patch("/{source_id}/chunks/{chunk_index}")
async def edit_chunk(
    source_id: str,
    chunk_index: int,
    body: UpdateChunkRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update a chunk's text and re-embed it in the vector store."""
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    new_text = body.text.strip()
    if not new_text:
        raise HTTPException(status_code=400, detail="Chunk text cannot be empty")

    # Re-embed the edited text
    embeddings = await embed_texts([new_text])

    ok = await update_chunk(
        master_id=source.master_id,
        source_id=source_id,
        chunk_index=chunk_index,
        new_text=new_text,
        new_embedding=embeddings[0],
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to update chunk in vector store")

    return {"status": "updated", "chunk_index": chunk_index}


@router.post("/{source_id}/translate")
async def translate_source_transcript(
    source_id: str,
    body: TranslateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Translate a source's transcript (and diarization segments) into a target language."""
    import json as _json

    if body.target_language not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail=f"Unsupported language: {body.target_language}")

    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    if source.status != IngestionStatus.completed:
        raise HTTPException(status_code=400, detail="Source is not yet processed")

    from app.config import get_settings
    from anthropic import AsyncAnthropic

    settings = get_settings()
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Translation requires an Anthropic API key")

    language_name = SUPPORTED_LANGUAGES[body.target_language]

    # Fetch content
    chunks = await get_source_chunks(source.master_id, source_id)
    full_text = "\n\n".join(c["text"] for c in chunks)

    segments = []
    if source.transcript_segments_json:
        try:
            segments = _json.loads(source.transcript_segments_json)
        except Exception:
            pass

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    if segments:
        # Translate segments as structured JSON — preserves speaker/timing metadata
        # Strip large arrays to just text+speaker to reduce token count
        slim = [{"i": i, "text": s["text"]} for i, s in enumerate(segments)]
        prompt = (
            f"Translate the following JSON array of transcript segments into {language_name}. "
            f"Return ONLY a valid JSON array. Each object must have exactly two keys: "
            f"\"i\" (the original index, unchanged) and \"text\" (translated text). "
            f"Preserve tone, names, and punctuation style.\n\n"
            f"{_json.dumps(slim, ensure_ascii=False)}"
        )
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        # Extract JSON array from response (in case Claude wraps it in markdown)
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        translated_slim = _json.loads(raw)
        # Merge translated text back into original segment structure
        translated_map = {item["i"]: item["text"] for item in translated_slim}
        translated_segments = [
            {**seg, "text": translated_map.get(i, seg["text"])}
            for i, seg in enumerate(segments)
        ]
        translated_text = " ".join(s["text"] for s in translated_segments)
    else:
        # No segments — translate the plain text directly
        prompt = (
            f"Translate the following transcript into {language_name}. "
            f"Return ONLY the translated text, preserving paragraph breaks. "
            f"Do not add any commentary or explanation.\n\n{full_text}"
        )
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        translated_text = response.content[0].text.strip()
        translated_segments = []

    return {
        "source_id": source_id,
        "target_language": body.target_language,
        "text": translated_text,
        "segments": translated_segments,
    }
