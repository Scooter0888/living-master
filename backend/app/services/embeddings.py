"""
Text chunking and OpenAI embedding generation.
"""
import asyncio
from typing import Optional
from functools import lru_cache

from openai import AsyncOpenAI
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config import get_settings


@lru_cache(maxsize=1)
def get_openai_client() -> AsyncOpenAI:
    settings = get_settings()
    return AsyncOpenAI(api_key=settings.openai_api_key)


@lru_cache(maxsize=1)
def get_text_splitter() -> RecursiveCharacterTextSplitter:
    settings = get_settings()
    return RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        length_function=len,
        separators=["\n\n", "\n", ". ", "! ", "? ", " ", ""],
    )


def chunk_text(text: str) -> list[str]:
    splitter = get_text_splitter()
    chunks = splitter.split_text(text)
    # Filter out very short chunks
    return [c.strip() for c in chunks if len(c.strip()) > 50]


async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []

    settings = get_settings()
    client = get_openai_client()

    # Batch in groups of 100 to respect API limits
    all_embeddings = []
    batch_size = 100

    for i in range(0, len(texts), batch_size):
        batch = texts[i: i + batch_size]
        response = await asyncio.wait_for(
            client.embeddings.create(model=settings.embedding_model, input=batch),
            timeout=60.0,  # 60s per batch — prevents silent hang if connection drops
        )
        batch_embeddings = [item.embedding for item in response.data]
        all_embeddings.extend(batch_embeddings)

    return all_embeddings


async def embed_query(text: str) -> list[float]:
    embeddings = await embed_texts([text])
    return embeddings[0]
