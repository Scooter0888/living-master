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
        ]:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass  # Column already exists — safe to ignore
    logger.info("Database initialized")
    logger.info(f"Chroma DB: {settings.chroma_db_path}")
    logger.info(f"Environment: {settings.app_env}")
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

    # Auth check (skip for health + docs)
    if request.url.path not in ("/health", "/docs", "/openapi.json", "/redoc"):
        token = request.headers.get("X-Access-Token") or request.query_params.get("token")
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

# Serve uploaded photos as static files
_photos_path = get_settings().photos_path
os.makedirs(_photos_path, exist_ok=True)
app.mount("/static/photos", StaticFiles(directory=_photos_path), name="photos")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "living-master-api", "version": "1.0.0"}
