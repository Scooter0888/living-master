"""
RAG pipeline: embed query → retrieve chunks → build prompt → call LLM.

Supports two inference backends (auto-selected from config.chat_model):
  - Anthropic (Claude Haiku/Sonnet)  — model name starts with "claude-"
  - OpenAI   (GPT-4o-mini / GPT-4o)  — model name starts with "gpt-"

The system prompt enforces strict source fidelity:
  - Responses must be grounded in the retrieved context
  - No extrapolation, speculation, or invented opinions
  - Every substantive claim must come from the master's actual documented words
"""
from typing import AsyncIterator

from anthropic import AsyncAnthropic

from app.config import get_settings
from app.services.embeddings import embed_query
from app.services.vector_store import query_documents


def get_anthropic_client() -> AsyncAnthropic:
    settings = get_settings()
    return AsyncAnthropic(api_key=settings.anthropic_api_key)


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

# STRICT mode: only documented words, no extrapolation
SYSTEM_PROMPT = """You are presenting the documented words and teachings of {master_name}.

Your ONLY source of truth is the retrieved context provided with each question. Follow these rules without exception:

1. Answer ONLY using content explicitly present in the retrieved context.
2. Quote {master_name} verbatim wherever possible — use their exact words, wrapped in quotation marks.
3. Speak in first person as {master_name}, presenting their own documented views.
4. When you use a direct quote you may frame it naturally, e.g.: "On this, I've said: '...' [source]"
5. If the retrieved context does not contain material relevant to the question, say clearly: "I don't have documented material on this specific topic in my knowledge base." Do not guess or fill the gap.
6. NEVER extrapolate, speculate, or invent ideas, opinions, or biographical details not explicitly present in the context.
7. NEVER say what {master_name} "would likely think", "probably believes", or "might say" — only what is documented.
8. Naturally cite the source of each quote (e.g. "In my interview with [publication]..." or "In [source title]...").

Movement/physical context: some chunks contain fused speech+movement data in this format:
  "[timestamp] {master_name} says: '...' — At this moment: [physical description]"
When you encounter these, weave the physical description into the response naturally — it is real documented content, not speculation.

Your responses should feel like {master_name} speaking from their actual record — every word traceable to what they really said."""

# CONTEXTUAL mode: inference explicitly labelled, grounded in documented philosophy
CONTEXTUAL_PROMPT = """You are drawing on your deep knowledge of {master_name}'s documented philosophy, teachings, and worldview — built entirely from their actual recorded words in the knowledge base.

The user asked a question that isn't directly answered by the retrieved context. Based on everything documented about {master_name}'s perspective, provide your best informed contextual inference.

Rules for contextual inference:
1. Open your response with a clear signal that this is inference, not a direct quote. For example: "While I don't have a specific statement on this, based on my documented approach to [related principle]..."
2. Ground every inference in {master_name}'s ACTUAL documented views — reference things they have genuinely said (from the retrieved context or the knowledge base at large).
3. Use language that signals inference: "based on my known principles...", "I would likely approach this as...", "in line with what I've taught about..."
4. NEVER invent biographical facts, specific events, or quotes that don't exist.
5. This is a thoughtful extrapolation from documented philosophy. Acknowledge where you are less certain.

Your response should feel like {master_name} making a considered, honest inference about something they may not have directly addressed — grounded in what they are known to believe."""


# ---------------------------------------------------------------------------
# Internal: build context block from retrieved chunks
# ---------------------------------------------------------------------------
def _build_context(chunks: list[dict], master_name: str) -> str:
    context_parts = []
    seen_sources: set[str] = set()

    for chunk in chunks:
        meta = chunk.get("metadata", {})
        title = meta.get("title", "Unknown Source")
        url = meta.get("url", "")

        if title not in seen_sources:
            seen_sources.add(title)
            header = f"[Source: {title}" + (f" | {url}" if url else "") + "]"
        else:
            header = f"[Continued: {title}]"

        context_parts.append(f"{header}\n{chunk['text']}")

    return "\n\n---\n\n".join(context_parts)


def _build_user_message(context: str, question: str, master_name: str) -> str:
    return (
        f"RETRIEVED CONTEXT (from {master_name}'s actual documented words):\n"
        f"{context}\n\n"
        f"---\n\n"
        f"QUESTION: {question}\n\n"
        f"Answer as {master_name} using ONLY the content above."
    )


# ---------------------------------------------------------------------------
# Anthropic backend
# ---------------------------------------------------------------------------
async def _stream_anthropic(system: str, user_msg: str, model: str) -> AsyncIterator[str]:
    client = get_anthropic_client()
    async with client.messages.stream(
        model=model,
        max_tokens=2048,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream_obj:
        async for text in stream_obj.text_stream:
            yield text


async def _call_anthropic(system: str, user_msg: str, model: str) -> str:
    client = get_anthropic_client()
    response = await client.messages.create(
        model=model,
        max_tokens=2048,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    )
    return response.content[0].text


# ---------------------------------------------------------------------------
# OpenAI backend (GPT-4o-mini etc.)
# ---------------------------------------------------------------------------
async def _stream_openai(system: str, user_msg: str, model: str) -> AsyncIterator[str]:
    from openai import AsyncOpenAI
    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    stream = await client.chat.completions.create(
        model=model,
        max_tokens=2048,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ],
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def _call_openai(system: str, user_msg: str, model: str) -> str:
    from openai import AsyncOpenAI
    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.chat.completions.create(
        model=model,
        max_tokens=2048,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ],
    )
    return response.choices[0].message.content or ""


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------
def _extract_sources(chunks: list[dict]) -> list[dict]:
    """Extract unique sources from retrieved chunks."""
    sources: list[dict] = []
    seen: set[str] = set()
    for chunk in chunks:
        meta = chunk.get("metadata", {})
        sid = meta.get("source_id", "")
        if sid and sid not in seen:
            seen.add(sid)
            sources.append({
                "title": meta.get("title", "Unknown Source"),
                "url": meta.get("url", ""),
                "content_type": meta.get("content_type", "web"),
                "score": round(chunk.get("score", 0), 3),
            })
    return sources


async def query_master(
    master_id: str,
    master_name: str,
    question: str,
    stream: bool = True,
    mode: str = "strict",          # "strict" | "contextual"
) -> AsyncIterator[str]:
    settings = get_settings()

    # 1. Embed the question
    query_embedding = await embed_query(question)

    # 2. Retrieve top-k relevant chunks
    chunks = await query_documents(master_id, query_embedding, k=settings.retrieval_k)

    if not chunks:
        yield "I don't have any material in my knowledge base yet. Please add some sources first."
        return

    # 3. Build context and prompt
    context = _build_context(chunks, master_name)
    prompt_template = CONTEXTUAL_PROMPT if mode == "contextual" else SYSTEM_PROMPT
    system = prompt_template.format(master_name=master_name)
    user_msg = _build_user_message(context, question, master_name)
    # Contextual inference needs Sonnet-class reasoning; strict quotes can use Haiku
    model = settings.claude_model if mode == "contextual" else settings.chat_model

    # 4. Stream from appropriate backend
    if model.startswith("gpt-"):
        async for text in _stream_openai(system, user_msg, model):
            yield text
    else:
        async for text in _stream_anthropic(system, user_msg, model):
            yield text

    # 5. Yield source metadata as a special marker after text stream
    import json
    yield f"\n[SOURCES]{json.dumps(_extract_sources(chunks))}"


async def get_answer_with_sources(
    master_id: str,
    master_name: str,
    question: str,
    mode: str = "strict",
) -> dict:
    settings = get_settings()

    query_embedding = await embed_query(question)
    chunks = await query_documents(master_id, query_embedding, k=settings.retrieval_k)

    if not chunks:
        return {
            "answer": "No knowledge base content found. Please add sources first.",
            "sources": [],
        }

    context = _build_context(chunks, master_name)
    prompt_template = CONTEXTUAL_PROMPT if mode == "contextual" else SYSTEM_PROMPT
    system = prompt_template.format(master_name=master_name)
    user_msg = _build_user_message(context, question, master_name)
    model = settings.claude_model if mode == "contextual" else settings.chat_model

    if model.startswith("gpt-"):
        answer = await _call_openai(system, user_msg, model)
    else:
        answer = await _call_anthropic(system, user_msg, model)

    # Build source list
    sources = []
    seen: set[str] = set()
    for chunk in chunks:
        meta = chunk.get("metadata", {})
        sid = meta.get("source_id", "")
        if sid and sid not in seen:
            seen.add(sid)
            sources.append({
                "title": meta.get("title", "Unknown Source"),
                "url": meta.get("url", ""),
                "content_type": meta.get("content_type", "web"),
                "score": chunk.get("score", 0),
            })

    return {"answer": answer, "sources": sources}
