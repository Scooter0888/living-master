"""
Discovery service: search the web for all public material on a person/topic.
Uses Serper.dev (Google Search API) + YouTube Data API.
"""
import asyncio
import httpx
from typing import Optional

from app.config import get_settings


SEARCH_CATEGORIES = [
    {"label": "Interviews", "query": '"{name}"{ctx} interview'},
    {"label": "Talks & Speeches", "query": '"{name}"{ctx} talk OR speech OR keynote'},
    {"label": "Podcasts", "query": '"{name}"{ctx} podcast'},
    {"label": "Articles & Essays", "query": '"{name}"{ctx} article OR essay OR writing'},
    {"label": "YouTube Videos", "query": '"{name}"{ctx} site:youtube.com'},
    {"label": "Wikipedia", "query": '"{name}"{ctx} site:wikipedia.org'},
]


async def discover_person(name: str, max_results_per_category: int = 10, context: str = "") -> dict:
    """
    Search for all public material on a person.
    Returns categorized results ready for the user to select and ingest.
    """
    settings = get_settings()
    tasks = []

    # Build context suffix — appended to every query to disambiguate the person
    ctx_suffix = f" {context.strip()}" if context.strip() else ""

    for category in SEARCH_CATEGORIES:
        query = category["query"].format(name=name, ctx=ctx_suffix)
        tasks.append(_serper_search(query, settings.serper_api_key, max_results_per_category))

    # YouTube: tiered search — dedicated videos + appearances
    yt_query_name = f"{name} {context.strip()}".strip() if context.strip() else name
    tasks.append(_youtube_search_tiered(yt_query_name, settings.youtube_api_key))

    all_results = await asyncio.gather(*tasks, return_exceptions=True)

    categories = []
    for i, category in enumerate(SEARCH_CATEGORIES):
        result = all_results[i]
        if isinstance(result, Exception):
            print(f"[Discovery] Search failed for '{category['label']}': {result}")
            items = []
        else:
            items = result

        categories.append({
            "label": category["label"],
            "items": items,
        })

    # Add YouTube category from direct API
    yt_results = all_results[-1]
    if not isinstance(yt_results, Exception) and yt_results:
        categories.append({
            "label": "YouTube (Direct)",
            "items": yt_results,
        })

    # Deduplicate across categories by URL, filter meta/talk pages
    import re
    SKIP_PATTERNS = [
        r"wikipedia\.org/wiki/Talk:",
        r"wikipedia\.org/wiki/Wikipedia:",
        r"wikipedia\.org/wiki/User:",
        r"wikipedia\.org/wiki/Special:",
        r"wikipedia\.org/wiki/Help:",
        r"wikipedia\.org/wiki/File:",
        r"wikipedia\.org/wiki/Category:",
        r"wikipedia\.org/wiki/Template:",
    ]
    def _should_skip(url: str) -> bool:
        return any(re.search(p, url) for p in SKIP_PATTERNS)

    seen_urls = set()
    for cat in categories:
        unique_items = []
        for item in cat["items"]:
            url = item.get("url", "")
            if url and url not in seen_urls and not _should_skip(url):
                seen_urls.add(url)
                unique_items.append(item)
        cat["items"] = unique_items

    total = sum(len(c["items"]) for c in categories)
    return {
        "name": name,
        "total_found": total,
        "categories": categories,
    }


async def _serper_search(query: str, api_key: str, max_results: int = 5) -> list[dict]:
    if not api_key or api_key == "your_serper_api_key_here":
        return await _duckduckgo_fallback(query, max_results)

    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            json={"q": query, "num": max_results},
        )
        response.raise_for_status()
        data = response.json()

    items = []
    for result in data.get("organic", [])[:max_results]:
        url = result.get("link", "")
        items.append({
            "title": result.get("title", ""),
            "url": url,
            "snippet": result.get("snippet", ""),
            "content_type": _infer_content_type(url),
        })
    return items


async def _duckduckgo_fallback(query: str, max_results: int = 5) -> list[dict]:
    """Fallback search using DuckDuckGo HTML scraping when no Serper key."""
    try:
        async with httpx.AsyncClient(
            timeout=15,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
            follow_redirects=True,
        ) as client:
            response = await client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
            )
            response.raise_for_status()

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(response.text, "html.parser")
        results = []
        for r in soup.select(".result__body")[:max_results]:
            title_el = r.select_one(".result__title")
            url_el = r.select_one(".result__url")
            snippet_el = r.select_one(".result__snippet")

            title = title_el.get_text(strip=True) if title_el else ""
            url = url_el.get_text(strip=True) if url_el else ""
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""

            if url and not url.startswith("http"):
                url = "https://" + url

            if url:
                results.append({
                    "title": title,
                    "url": url,
                    "snippet": snippet,
                    "content_type": _infer_content_type(url),
                })
        return results
    except Exception as e:
        print(f"[Discovery] DuckDuckGo fallback failed: {e}")
        return []


async def _youtube_search(query: str, api_key: str, max_results: int = 50, page_token: str = "") -> list[dict]:
    """Single YouTube API search request."""
    params = {
        "part": "snippet",
        "q": query,
        "type": "video",
        "maxResults": min(max_results, 50),
        "order": "relevance",
        "key": api_key,
    }
    if page_token:
        params["pageToken"] = page_token

    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            "https://www.googleapis.com/youtube/v3/search",
            params=params,
        )
        if response.status_code != 200:
            return []
        data = response.json()

    items = []
    for item in data.get("items", []):
        video_id = item["id"].get("videoId", "")
        snippet = item.get("snippet", {})
        if video_id:
            items.append({
                "title": snippet.get("title", ""),
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "snippet": snippet.get("description", ""),
                "thumbnail_url": snippet.get("thumbnails", {}).get("medium", {}).get("url"),
                "content_type": "youtube",
                "author": snippet.get("channelTitle"),
                "_next_page_token": data.get("nextPageToken", ""),
            })
    return items


async def _youtube_search_tiered(name: str, api_key: str) -> list[dict]:
    """
    Tiered YouTube search:
      Tier 1 — Dedicated clips: exact name match (up to 100 results, 2 pages)
      Tier 2 — Appearances/mentions: broader name search (up to 50 more results)
    Results are deduplicated and ordered tier 1 first.
    """
    if not api_key or api_key == "your_youtube_api_key_here":
        return []

    seen_ids: set[str] = set()
    results: list[dict] = []

    def _add(items: list[dict]):
        for item in items:
            vid = item["url"].split("v=")[-1]
            if vid not in seen_ids:
                seen_ids.add(vid)
                results.append(item)

    # Tier 1a: exact name, page 1 (50 results)
    tier1a = await _youtube_search(f'"{name}"', api_key, max_results=50)
    _add(tier1a)

    # Tier 1b: exact name, page 2 (50 more results)
    if tier1a and tier1a[-1].get("_next_page_token"):
        tier1b = await _youtube_search(
            f'"{name}"', api_key, max_results=50,
            page_token=tier1a[-1]["_next_page_token"],
        )
        _add(tier1b)

    # Tier 2: broader search catches appearances where name isn't in title
    tier2 = await _youtube_search(name, api_key, max_results=50)
    _add(tier2)

    # Strip internal pagination key before returning
    for item in results:
        item.pop("_next_page_token", None)

    return results


async def list_channel_videos(channel_url: str) -> list[dict]:
    """
    Use yt-dlp to list all videos in a YouTube channel/playlist URL.
    Returns [{title, url, thumbnail_url, duration_seconds, author}].
    Does NOT download anything — flat extraction only.
    """
    import asyncio

    def _extract():
        import yt_dlp
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
            "skip_download": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(channel_url, download=False)

        videos = []
        channel_name = info.get("channel") or info.get("uploader") or ""
        entries = info.get("entries") or []

        for entry in entries:
            if not entry:
                continue
            video_id = entry.get("id", "")
            video_url = entry.get("url") or (f"https://www.youtube.com/watch?v={video_id}" if video_id else "")
            if not video_url:
                continue
            # Normalise to full watch URL if yt-dlp returned just an ID
            if not video_url.startswith("http"):
                video_url = f"https://www.youtube.com/watch?v={video_url}"
            thumbnails = entry.get("thumbnails") or []
            thumbnail_url = thumbnails[-1].get("url", "") if thumbnails else entry.get("thumbnail", "")
            videos.append({
                "title": entry.get("title") or video_url,
                "url": video_url,
                "content_type": "youtube",
                "thumbnail_url": thumbnail_url,
                "author": channel_name,
                "duration_seconds": entry.get("duration"),
            })
        return videos

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _extract)


def _infer_content_type(url: str) -> str:
    lower = url.lower()
    if "youtube.com" in lower or "youtu.be" in lower:
        return "youtube"
    if lower.endswith(".pdf"):
        return "pdf"
    if lower.endswith(".mp3") or lower.endswith(".wav") or lower.endswith(".m4a"):
        return "audio"
    if lower.endswith(".mp4") or lower.endswith(".mkv"):
        return "video"
    return "web"
