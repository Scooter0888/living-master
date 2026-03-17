"""
Russian → English translation via Claude Haiku.
Used to translate Mikhail's speech segments after speaker identification.
"""
import asyncio
import logging

logger = logging.getLogger("living_master.translation")

_WORDS_PER_CHUNK = 3000  # Stay well within Claude's token limit


def is_russian(text: str) -> bool:
    """Return True if >20% of characters are Cyrillic (i.e. Russian-dominant)."""
    if not text:
        return False
    cyrillic = sum(1 for c in text if "\u0400" <= c <= "\u04FF")
    return cyrillic / len(text) > 0.20


def detect_russian_speaker(aligned_segments: list[dict]) -> str | None:
    """
    Given speaker-aligned transcript segments [{speaker, text, start, end}],
    return the speaker ID whose text is predominantly Russian, or None if not found.
    """
    speaker_text: dict[str, list[str]] = {}
    for seg in aligned_segments:
        spk = seg.get("speaker")
        text = seg.get("text", "")
        if spk and text:
            speaker_text.setdefault(spk, []).append(text)

    for speaker, texts in speaker_text.items():
        combined = " ".join(texts)
        if is_russian(combined):
            logger.info(f"[Translation] Russian speaker detected: {speaker}")
            return speaker

    return None


async def translate_to_english(text: str) -> str:
    """
    Translate Russian text to English using Claude Haiku.
    Splits into chunks to handle very long transcripts.
    """
    from anthropic import AsyncAnthropic
    from app.config import get_settings

    settings = get_settings()
    if not settings.anthropic_api_key:
        logger.warning("[Translation] No Anthropic API key — returning untranslated text")
        return text

    if not is_russian(text):
        return text  # Already English

    words = text.split()
    chunks = [
        " ".join(words[i : i + _WORDS_PER_CHUNK])
        for i in range(0, len(words), _WORDS_PER_CHUNK)
    ]

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    translated_parts = []

    for i, chunk in enumerate(chunks):
        logger.info(f"[Translation] Translating chunk {i+1}/{len(chunks)} ({len(chunk.split())} words)")
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            messages=[{
                "role": "user",
                "content": (
                    "Translate the following Russian transcript to English. "
                    "Preserve the speaker's natural speaking style, tone, and meaning. "
                    "Return only the translation — no commentary or explanations.\n\n"
                    + chunk
                ),
            }],
        )
        translated_parts.append(response.content[0].text.strip())

    return "\n\n".join(translated_parts)


async def translate_segments_to_english(segments: list[dict]) -> list[dict]:
    """
    Translate the 'text' field of each segment from Russian to English.
    Batches all text into one call per ~3000 words.
    """
    if not segments:
        return segments

    combined = " ".join(s.get("text", "") for s in segments)
    if not is_russian(combined):
        return segments  # Already English

    # Translate all segment texts in one batch via concatenation
    texts = [s.get("text", "") for s in segments]
    joined = "\n---\n".join(texts)

    from anthropic import AsyncAnthropic
    from app.config import get_settings
    settings = get_settings()
    if not settings.anthropic_api_key:
        return segments

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    # Split into batches by the separator
    word_count = len(joined.split())
    if word_count <= _WORDS_PER_CHUNK:
        batches = [joined]
    else:
        # Split segments into batches
        batch_size = max(1, len(segments) * _WORDS_PER_CHUNK // word_count)
        batches = []
        for i in range(0, len(texts), batch_size):
            batches.append("\n---\n".join(texts[i : i + batch_size]))

    translated_texts = []
    for batch in batches:
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            messages=[{
                "role": "user",
                "content": (
                    "Translate each of the following Russian transcript segments to English. "
                    "Each segment is separated by '---'. Return ONLY the translated segments "
                    "in the same order, separated by '---'. No commentary.\n\n" + batch
                ),
            }],
        )
        parts = response.content[0].text.strip().split("---")
        translated_texts.extend(p.strip() for p in parts)

    # Merge back — zip defensively in case count drifts slightly
    result = []
    for seg, translated in zip(segments, translated_texts):
        result.append({**seg, "text": translated})
    # Append any remaining untranslated segments (shouldn't happen but safe)
    for seg in segments[len(result):]:
        result.append(seg)

    return result
