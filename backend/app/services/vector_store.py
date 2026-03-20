"""
Chroma vector store operations.
Each master gets its own Chroma collection.
"""
import asyncio
from typing import Optional
from functools import lru_cache

import chromadb
from chromadb.config import Settings as ChromaSettings

from app.config import get_settings


@lru_cache(maxsize=1)
def get_chroma_client() -> chromadb.PersistentClient:
    settings = get_settings()
    client = chromadb.PersistentClient(
        path=settings.chroma_db_path,
        settings=ChromaSettings(anonymized_telemetry=False),
    )
    print(f"[Chroma] Connected to persistent store at {settings.chroma_db_path}")
    return client


def _collection_name(master_id: str) -> str:
    # Chroma collection names must be 3-63 chars, alphanumeric + hyphens
    return f"master-{master_id.replace('_', '-')}"


def _sanitize_metadata(meta: dict) -> dict:
    """ChromaDB only accepts str/int/float/bool metadata values — strip or convert everything else."""
    clean = {}
    for k, v in meta.items():
        if v is None:
            continue  # drop None values
        if isinstance(v, (str, int, float, bool)):
            clean[k] = v
        else:
            clean[k] = str(v)
    return clean


async def add_documents(
    master_id: str,
    source_id: str,
    chunks: list[str],
    metadatas: list[dict],
    embeddings: list[list[float]],
) -> int:
    loop = asyncio.get_event_loop()

    def _add():
        client = get_chroma_client()
        collection = client.get_or_create_collection(
            name=_collection_name(master_id),
            metadata={"hnsw:space": "cosine"},
        )
        ids = [f"{source_id}-chunk-{i}" for i in range(len(chunks))]
        collection.add(
            ids=ids,
            documents=chunks,
            metadatas=[_sanitize_metadata(m) for m in metadatas],
            embeddings=embeddings,
        )
        return len(chunks)

    return await loop.run_in_executor(None, _add)


async def query_documents(
    master_id: str,
    query_embedding: list[float],
    k: int = 6,
) -> list[dict]:
    loop = asyncio.get_event_loop()

    def _query():
        client = get_chroma_client()
        try:
            collection = client.get_collection(_collection_name(master_id))
        except Exception:
            return []

        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=min(k, collection.count()),
            include=["documents", "metadatas", "distances"],
        )

        docs = []
        for i, doc in enumerate(results["documents"][0]):
            docs.append({
                "text": doc,
                "metadata": results["metadatas"][0][i],
                "score": 1 - results["distances"][0][i],  # cosine similarity
            })
        return docs

    return await loop.run_in_executor(None, _query)


async def delete_source_chunks(master_id: str, source_id: str) -> None:
    loop = asyncio.get_event_loop()

    def _delete():
        client = get_chroma_client()
        try:
            collection = client.get_collection(_collection_name(master_id))
            collection.delete(where={"source_id": source_id})
        except Exception:
            pass

    await loop.run_in_executor(None, _delete)


async def delete_master_collection(master_id: str) -> None:
    loop = asyncio.get_event_loop()

    def _delete():
        client = get_chroma_client()
        try:
            client.delete_collection(_collection_name(master_id))
        except Exception:
            pass

    await loop.run_in_executor(None, _delete)


async def get_source_chunks(master_id: str, source_id: str) -> list[dict]:
    """Retrieve all chunks for a source, ordered by chunk_index."""
    loop = asyncio.get_event_loop()

    def _get():
        client = get_chroma_client()
        try:
            collection = client.get_collection(_collection_name(master_id))
            results = collection.get(
                where={"source_id": source_id},
                include=["documents", "metadatas"],
            )
            combined = list(zip(results["documents"], results["metadatas"]))
            combined.sort(key=lambda x: x[1].get("chunk_index", 0))
            return [
                {
                    "text": doc,
                    "chunk_index": meta.get("chunk_index", i),
                    "speaker": meta.get("speaker"),
                }
                for i, (doc, meta) in enumerate(combined)
            ]
        except Exception:
            return []

    return await loop.run_in_executor(None, _get)


async def get_all_chunks(master_id: str, limit: int = 1000) -> list[dict]:
    """Retrieve all chunks for a master, grouped by source in chunk_index order."""
    loop = asyncio.get_event_loop()

    def _get():
        client = get_chroma_client()
        try:
            collection = client.get_collection(_collection_name(master_id))
            count = collection.count()
            if count == 0:
                return []
            results = collection.get(
                include=["documents", "metadatas"],
                limit=min(count, limit),
            )
            combined = list(zip(results["documents"], results["metadatas"]))
            combined.sort(key=lambda x: (x[1].get("source_id", ""), x[1].get("chunk_index", 0)))
            return [
                {
                    "text": doc,
                    "title": meta.get("title", "Unknown"),
                    "source_id": meta.get("source_id", ""),
                    "content_type": meta.get("content_type", "web"),
                    "chunk_index": meta.get("chunk_index", 0),
                }
                for doc, meta in combined
            ]
        except Exception:
            return []

    return await loop.run_in_executor(None, _get)


async def get_collection_count(master_id: str) -> int:
    loop = asyncio.get_event_loop()

    def _count():
        client = get_chroma_client()
        try:
            collection = client.get_collection(_collection_name(master_id))
            return collection.count()
        except Exception:
            return 0

    return await loop.run_in_executor(None, _count)


async def update_chunk(
    master_id: str,
    source_id: str,
    chunk_index: int,
    new_text: str,
    new_embedding: list[float],
) -> bool:
    """Update a single chunk's text and embedding in-place."""
    loop = asyncio.get_event_loop()

    def _update():
        client = get_chroma_client()
        try:
            collection = client.get_collection(_collection_name(master_id))
            chunk_id = f"{source_id}-chunk-{chunk_index}"
            collection.update(
                ids=[chunk_id],
                documents=[new_text],
                embeddings=[new_embedding],
            )
            return True
        except Exception:
            return False

    return await loop.run_in_executor(None, _update)


async def find_duplicate_sources(master_id: str, threshold: float = 0.92) -> list[dict]:
    """Find sources with high text overlap. Compares first chunks of each source pair via cosine similarity."""
    loop = asyncio.get_event_loop()

    def _find():
        client = get_chroma_client()
        try:
            collection = client.get_collection(_collection_name(master_id))
            # Get first chunk (chunk_index=0) for each source
            results = collection.get(
                where={"chunk_index": 0},
                include=["documents", "metadatas", "embeddings"],
            )
            if not results["ids"]:
                return []

            docs = results["documents"]
            metas = results["metadatas"]
            embeddings = results["embeddings"]

            # Build per-source data
            sources_data = []
            for i, (doc, meta, emb) in enumerate(zip(docs, metas, embeddings)):
                sources_data.append({
                    "source_id": meta.get("source_id", ""),
                    "title": meta.get("title", "Unknown"),
                    "content_type": meta.get("content_type", "web"),
                    "text_preview": doc[:200] if doc else "",
                    "embedding": emb,
                })

            # Compare all pairs
            import math
            duplicates = []
            for i in range(len(sources_data)):
                for j in range(i + 1, len(sources_data)):
                    a, b = sources_data[i], sources_data[j]
                    # Skip if same source
                    if a["source_id"] == b["source_id"]:
                        continue
                    # Cosine similarity
                    dot = sum(x * y for x, y in zip(a["embedding"], b["embedding"]))
                    norm_a = math.sqrt(sum(x * x for x in a["embedding"]))
                    norm_b = math.sqrt(sum(x * x for x in b["embedding"]))
                    if norm_a == 0 or norm_b == 0:
                        continue
                    similarity = dot / (norm_a * norm_b)
                    if similarity >= threshold:
                        duplicates.append({
                            "source_a": {"id": a["source_id"], "title": a["title"], "content_type": a["content_type"]},
                            "source_b": {"id": b["source_id"], "title": b["title"], "content_type": b["content_type"]},
                            "similarity": round(similarity, 3),
                            "preview_a": a["text_preview"],
                            "preview_b": b["text_preview"],
                        })

            duplicates.sort(key=lambda x: x["similarity"], reverse=True)
            return duplicates
        except Exception:
            return []

    return await loop.run_in_executor(None, _find)


async def get_random_chunks(master_id: str, n: int = 8) -> list[str]:
    """Return up to n random document chunks from the master's collection."""
    import random
    loop = asyncio.get_event_loop()

    def _get():
        client = get_chroma_client()
        try:
            collection = client.get_collection(_collection_name(master_id))
            count = collection.count()
            if count == 0:
                return []
            # Get all IDs then sample
            all_ids = collection.get(include=[])["ids"]
            sampled = random.sample(all_ids, min(n, len(all_ids)))
            result = collection.get(ids=sampled, include=["documents"])
            return result["documents"]
        except Exception:
            return []

    return await loop.run_in_executor(None, _get)
