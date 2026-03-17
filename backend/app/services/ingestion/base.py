from dataclasses import dataclass, field
from typing import Optional


@dataclass
class IngestedContent:
    """Normalized output from any ingestion source."""
    text: str
    title: str
    content_type: str
    url: Optional[str] = None
    author: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration_seconds: Optional[int] = None
    metadata: dict = field(default_factory=dict)
    # Diarization output: [{text, start, end, speaker, is_master}]
    segments: list = field(default_factory=list)
    # Raw Whisper segments with timestamps: [{text, start, end}]
    transcript_segments: list = field(default_factory=list)
    # Video path — used internally during ingestion, always blank in returned value
    video_path: str = ""
    # Pre-computed fused speech+vision chunks from movement analysis
    # [{timestamp, text, chunk_index, spoken, physical}]
    movement_chunks: list = field(default_factory=list)
    # The detected master speaker ID (e.g. "SPEAKER_00") — the Russian-speaking voice
    speaker_label: Optional[str] = None
