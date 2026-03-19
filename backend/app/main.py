import logging
import time
import uuid
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os

# Add local ffmpeg binary to PATH so yt-dlp and shutil.which can find it
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = _BACKEND_DIR + os.pathsep + os.environ.get("PATH", "")

from app.config import get_settings
from app.database import init_db, engine
from app.routers import masters, ingest, query, discover, sources
from app.routers import media as media_router_module
from app.routers import voice as voice_router_module
from app.routers import backup as backup_router_module
from sqlalchemy import text

# Structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("living_master")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    os.makedirs(settings.data_dir, exist_ok=True)
    os.makedirs(settings.chroma_db_path, exist_ok=True)
    os.makedirs(settings.uploads_path, exist_ok=True)
    os.makedirs(settings.photos_path, exist_ok=True)
    os.makedirs(settings.voice_samples_path, exist_ok=True)
    await init_db()
    # Safe column migrations — no-op if column already exists
    async with engine.begin() as conn:
        for stmt in [
            "ALTER TABLE sources ADD COLUMN word_count INTEGER DEFAULT 0",
            "ALTER TABLE masters ADD COLUMN voice_id TEXT",
            "ALTER TABLE masters ADD COLUMN voice_status TEXT DEFAULT 'none'",
            "ALTER TABLE sources ADD COLUMN speaker_label TEXT",
            "ALTER TABLE sources ADD COLUMN has_diarization INTEGER DEFAULT 0",
            "ALTER TABLE sources ADD COLUMN has_movement_analysis INTEGER DEFAULT 0",
            "ALTER TABLE sources ADD COLUMN speaker_count INTEGER",
            "ALTER TABLE sources ADD COLUMN video_path TEXT",
            "ALTER TABLE sources ADD COLUMN transcript_segments_json TEXT",
            "ALTER TABLE masters ADD COLUMN profile_photo_path TEXT",
            "ALTER TABLE sources ADD COLUMN speaker_samples_json TEXT",
            "ALTER TABLE sources ADD COLUMN processing_stage TEXT",
            "ALTER TABLE sources ADD COLUMN progress_pct INTEGER",
        ]:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass  # Column already exists — safe to ignore
    logger.info("Database initialized")
    logger.info(f"Chroma DB: {settings.chroma_db_path}")
    logger.info(f"Environment: {settings.app_env}")

    # Auto-resume any sources that were left in processing/pending state
    # when the backend was previously killed (e.g. during ingestion).
    # Only URL-based sources can be auto-resumed; file uploads need the
    # original file which may no longer be present.
    async def _resume_pending():
        import asyncio
        await asyncio.sleep(2)  # Let the server finish starting before queueing work
        from app.database import AsyncSessionLocal
        from app.models import Source, IngestionStatus
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Source).where(
                    Source.status.in_([IngestionStatus.pending, IngestionStatus.processing]),
                    Source.url.isnot(None),
                )
            )
            stuck = result.scalars().all()
            if not stuck:
                return
            logger.info(f"[Startup] Resuming {len(stuck)} pending/processing URL sources")
            for s in stuck:
                s.status = IngestionStatus.pending
                s.error_message = None
            await db.commit()
            source_ids_urls = [(s.id, s.master_id, s.url) for s in stuck]

        from app.routers.ingest import ingest_url, _process_source, delete_source_chunks
        for source_id, master_id, url in source_ids_urls:
            try:
                await delete_source_chunks(master_id, source_id)
                ingested = await ingest_url(url)
                await _process_source(source_id=source_id, master_id=master_id,
                                      db_session_factory=AsyncSessionLocal, content=ingested)
            except Exception as e:
                async with AsyncSessionLocal() as db2:
                    r = await db2.execute(select(Source).where(Source.id == source_id))
                    src = r.scalar_one_or_none()
                    if src:
                        src.status = IngestionStatus.failed
                        src.error_message = str(e)
                        await db2.commit()
            await asyncio.sleep(1)

    import asyncio
    asyncio.ensure_future(_resume_pending())
    yield


app = FastAPI(
    title="Living Master API",
    description="Build a living intelligence from any public figure's complete body of work.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

settings = get_settings()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Security headers
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# Request logging + auth
@app.middleware("http")
async def logging_and_auth(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    start = time.monotonic()

    # Auth check (skip for health, docs, and CORS preflight)
    if request.method != "OPTIONS" and request.url.path not in ("/health", "/docs", "/openapi.json", "/redoc"):
        token = request.headers.get("X-Access-Token")
        if settings.app_env == "production" and token != settings.access_token:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    response = await call_next(request)
    duration_ms = round((time.monotonic() - start) * 1000)
    logger.info(
        f"[{request_id}] {request.method} {request.url.path} → {response.status_code} ({duration_ms}ms)"
    )
    return response


from app.routers import export as export_router
app.include_router(masters.router)
app.include_router(ingest.router)
app.include_router(query.router)
app.include_router(discover.router)
app.include_router(sources.router)
app.include_router(export_router.router)
app.include_router(media_router_module.router)
app.include_router(voice_router_module.router)
app.include_router(backup_router_module.router)

# Serve uploaded photos as static files
_photos_path = get_settings().photos_path
os.makedirs(_photos_path, exist_ok=True)
app.mount("/static/photos", StaticFiles(directory=_photos_path), name="photos")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "living-master-api", "version": "1.0.0"}


@app.get("/capabilities")
async def capabilities():
    """Return which AI features are configured and available."""
    return {
        "diarization": bool(settings.huggingface_token),
        "voice_cloning": bool(settings.elevenlabs_api_key),
        "movement_analysis": bool(settings.anthropic_api_key),
        "tts": True,  # edge-tts always available, no API key needed
        "rag": bool(settings.anthropic_api_key or settings.openai_api_key),
    }
