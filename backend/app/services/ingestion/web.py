"""
Web page ingestion using Trafilatura for clean text extraction.
Falls back to BeautifulSoup if Trafilatura returns nothing.
Wikipedia articles use the Wikipedia API for clean text.
"""
import asyncio
import httpx
import re
from typing import Optional
from urllib.parse import urlparse

from app.services.ingestion.base import IngestedContent

# Rotate through a few realistic user agents
USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
]

BLOCKED_URL_PATTERNS = [
    r"wikipedia\.org/wiki/Talk:",
    r"wikipedia\.org/wiki/Wikipedia:",
    r"wikipedia\.org/wiki/User:",
    r"wikipedia\.org/wiki/Special:",
    r"wikipedia\.org/wiki/Help:",
    r"wikipedia\.org/wiki/File:",
]


def _is_blocked_url(url: str) -> bool:
    for pattern in BLOCKED_URL_PATTERNS:
        if re.search(pattern, url):
            return True
    return False


def _is_wikipedia_article(url: str) -> bool:
    return bool(re.search(r"\w+\.wikipedia\.org/wiki/(?!Talk:|User:|Wikipedia:|Special:|Help:|File:|Category:|Template:)", url))


def _wikipedia_lang_and_title(url: str) -> tuple[str, str]:
    lang_match = re.search(r"(\w+)\.wikipedia\.org/wiki/(.+)", url)
    if lang_match:
        return lang_match.group(1), lang_match.group(2).replace("_", " ")
    return "en", ""


async def ingest_web(url: str) -> IngestedContent:
    if _is_blocked_url(url):
        raise ValueError(f"Skipped: Talk/meta page not useful for knowledge base: {url}")

    # Use Wikipedia API for cleaner extraction (never scrape wikipedia.org directly - always 403)
    if _is_wikipedia_article(url):
        return await _ingest_wikipedia(url)

    # Block direct wikipedia scraping for non-article pages
    if "wikipedia.org" in url:
        raise ValueError(f"Skipped unsupported Wikipedia page: {url}")

    return await _ingest_generic(url)


async def _ingest_wikipedia(url: str) -> IngestedContent:
    lang_code, title = _wikipedia_lang_and_title(url)
    loop = asyncio.get_event_loop()

    def _fetch_sync():
        import requests as req
        ua = {"User-Agent": USER_AGENTS[0]}

        # Full text via MediaWiki API (handles redirects)
        r = req.get(
            f"https://{lang_code}.wikipedia.org/w/api.php",
            params={"action": "query", "titles": title, "prop": "extracts",
                    "explaintext": "1", "exsectionformat": "plain",
                    "format": "json", "redirects": "1"},
            headers=ua, timeout=20,
        )
        r.raise_for_status()
        data = r.json()
        pages = data.get("query", {}).get("pages", {})
        full_text = ""
        article_title = title
        for page in pages.values():
            extract = page.get("extract", "")
            if extract and extract.strip():
                full_text = extract
                article_title = page.get("title", title)

        # Summary for thumbnail
        thumbnail = None
        try:
            sr = req.get(
                f"https://{lang_code}.wikipedia.org/api/rest_v1/page/summary/{title}",
                headers=ua, timeout=10,
            )
            if sr.status_code == 200:
                sd = sr.json()
                thumbnail = sd.get("thumbnail", {}).get("source")
                if not article_title or article_title == title:
                    article_title = sd.get("title", article_title)
        except Exception:
            pass

        return full_text, article_title, thumbnail

    full_text, article_title, thumbnail = await loop.run_in_executor(None, _fetch_sync)

    if not full_text:
        raise ValueError("Wikipedia API returned no content")

    return IngestedContent(
        text=full_text,
        title=article_title,
        content_type="web",
        url=url,
        thumbnail_url=thumbnail,
        metadata={"domain": "wikipedia.org", "source": "wikipedia_api"},
    )


async def _ingest_generic(url: str) -> IngestedContent:
    loop = asyncio.get_event_loop()

    for i, ua in enumerate(USER_AGENTS):
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
                response = await client.get(url, headers={
                    "User-Agent": ua,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate, br",
                    "DNT": "1",
                })
                response.raise_for_status()
                html = response.text
            break
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 403 and i < len(USER_AGENTS) - 1:
                continue
            raise ValueError(f"Could not access URL ({e.response.status_code}): {url}")

    # Try Trafilatura first
    def _extract_trafilatura(html_content: str):
        import trafilatura
        result = trafilatura.extract(
            html_content,
            include_comments=False,
            include_tables=True,
            no_fallback=False,
            favor_recall=True,
        )
        meta = trafilatura.extract_metadata(html_content)
        title = meta.title if meta else None
        author = meta.author if meta else None
        return result, title, author

    text, title, author = await loop.run_in_executor(None, _extract_trafilatura, html)

    # Fallback to BeautifulSoup
    if not text or len(text.strip()) < 100:
        def _extract_bs4(html_content: str):
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html_content, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
                tag.decompose()
            extracted_title = soup.title.string.strip() if soup.title else None
            paragraphs = soup.find_all(["p", "h1", "h2", "h3", "h4", "article"])
            extracted_text = "\n\n".join(p.get_text(strip=True) for p in paragraphs if p.get_text(strip=True))
            return extracted_text, extracted_title

        text, bs_title = await loop.run_in_executor(None, _extract_bs4, html)
        if not title:
            title = bs_title

    if not text or len(text.strip()) < 50:
        raise ValueError(f"Could not extract meaningful content from {url}")

    domain = urlparse(url).netloc
    return IngestedContent(
        text=text.strip(),
        title=title or domain,
        content_type="web",
        url=url,
        author=author,
        metadata={"domain": domain},
    )
