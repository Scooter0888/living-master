from pydantic_settings import BaseSettings
from functools import lru_cache
import os


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    serper_api_key: str = ""
    youtube_api_key: str = ""

    app_env: str = "development"
    cors_origins: str = "http://localhost:3000"
    access_token: str = "change_this_to_a_secure_token"

    chroma_db_path: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "chroma_db")
    uploads_path: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
    photos_path: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "photos")
    voice_samples_path: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "voice_samples")

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

    # Max upload file size in megabytes
    max_upload_mb: int = 500

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
