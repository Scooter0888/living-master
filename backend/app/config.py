from pydantic_settings import BaseSettings
from functools import lru_cache
import os

# Default local data dir = the backend package root
_LOCAL_DATA_DIR = os.path.dirname(os.path.dirname(__file__))


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    serper_api_key: str = ""
    youtube_api_key: str = ""

    app_env: str = "development"
    cors_origins: str = "http://localhost:3000"
    access_token: str = "change_this_to_a_secure_token"   # admin — full access
    shared_token: str = ""                                  # viewer — public masters only

    # DATA_DIR: Railway sets this to /data (volume mount) so data persists across deploys.
    # Locally defaults to the backend directory so existing data paths are unchanged.
    data_dir: str = _LOCAL_DATA_DIR

    elevenlabs_api_key: str = ""
    huggingface_token: str = ""

    embedding_model: str = "text-embedding-3-small"
    # Chat model for RAG Q&A responses
    # Options: "claude-haiku-4-5-20251001" | "claude-sonnet-4-6" | "gpt-4o-mini" | "gpt-4o"
    chat_model: str = "claude-haiku-4-5-20251001"
    # Writing model for book/topic generation — needs to be high quality
    claude_model: str = "claude-sonnet-4-6"

    chunk_size: int = 1000
    chunk_overlap: int = 200
    retrieval_k: int = 8

    # Whisper transcription model: "tiny" | "base" | "small" | "medium" | "large"
    whisper_model: str = "base"

    # Max upload file size in megabytes (10 GB default for local; override in production)
    max_upload_mb: int = 10000

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def chroma_db_path(self) -> str:
        return os.path.join(self.data_dir, "chroma_db")

    @property
    def uploads_path(self) -> str:
        return os.path.join(self.data_dir, "uploads")

    @property
    def photos_path(self) -> str:
        return os.path.join(self.data_dir, "photos")

    @property
    def voice_samples_path(self) -> str:
        return os.path.join(self.data_dir, "voice_samples")

    @property
    def db_path(self) -> str:
        return os.path.join(self.data_dir, "living_master.db")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
