from sqlalchemy import Column, String, DateTime, Integer, Text, Boolean, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
import enum

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class IngestionStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"
    needs_speaker_id = "needs_speaker_id"


class ContentType(str, enum.Enum):
    youtube = "youtube"
    web = "web"
    audio = "audio"
    video = "video"
    pdf = "pdf"
    docx = "docx"
    iso = "iso"
    text = "text"


class Master(Base):
    __tablename__ = "masters"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    avatar_color = Column(String, default="#6366f1")
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    voice_id = Column(String, nullable=True)
    voice_status = Column(String, default="none")  # "none" | "cloning" | "ready"
    profile_photo_path = Column(Text, nullable=True)
    is_private = Column(Boolean, default=False)     # True = admin-only; False = visible to shared users

    sources = relationship("Source", back_populates="master", cascade="all, delete-orphan")
    photos = relationship("Photo", back_populates="master", cascade="all, delete-orphan")

    @property
    def source_count(self) -> int:
        return len([s for s in self.sources if s.status == IngestionStatus.completed])

    @property
    def total_chunks(self) -> int:
        return sum(s.chunk_count or 0 for s in self.sources)


class Source(Base):
    __tablename__ = "sources"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    master_id = Column(String, ForeignKey("masters.id"), nullable=False)
    url = Column(Text, nullable=True)
    title = Column(String, nullable=True)
    content_type = Column(SAEnum(ContentType), nullable=False)
    status = Column(SAEnum(IngestionStatus), default=IngestionStatus.pending)
    error_message = Column(Text, nullable=True)
    chunk_count = Column(Integer, default=0)
    word_count = Column(Integer, default=0)
    duration_seconds = Column(Integer, nullable=True)
    thumbnail_url = Column(Text, nullable=True)
    author = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Diarization fields
    speaker_label = Column(String, nullable=True)       # e.g. "SPEAKER_00" — the master's speaker
    has_diarization = Column(Boolean, default=False)
    speaker_count = Column(Integer, nullable=True)
    speaker_samples_json = Column(Text, nullable=True)  # JSON: {SPEAKER_00: ["quote1","quote2"], ...}
    # Processing stage and progress (set during ingestion for user-visible progress)
    processing_stage = Column(String, nullable=True)  # e.g. "Downloading", "Transcribing", "Indexing"
    progress_pct = Column(Integer, nullable=True)     # 0–100 progress percentage
    # Movement analysis
    has_movement_analysis = Column(Boolean, default=False)
    # For speech+movement fusion
    video_path = Column(Text, nullable=True)             # path to kept video file
    transcript_segments_json = Column(Text, nullable=True)  # JSON: [{text,start,end}, ...]

    master = relationship("Master", back_populates="sources")


class Photo(Base):
    __tablename__ = "photos"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    master_id = Column(String, ForeignKey("masters.id"), nullable=False)
    filename = Column(String, nullable=False)
    caption = Column(Text, nullable=True)
    file_path = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    master = relationship("Master", back_populates="photos")
