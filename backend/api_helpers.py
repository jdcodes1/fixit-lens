import os
import aiohttp

GOOGLE_CSE_API_KEY = os.environ.get("GOOGLE_CSE_API_KEY", "")
GOOGLE_CSE_ID = os.environ.get("GOOGLE_CSE_ID", "")
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", os.environ.get("GOOGLE_API_KEY", ""))


async def search_parts(query: str) -> list[dict]:
    """Search Google Custom Search for parts to buy."""
    if not GOOGLE_CSE_API_KEY or not GOOGLE_CSE_ID:
        return []
    url = "https://www.googleapis.com/customsearch/v1"
    params = {
        "key": GOOGLE_CSE_API_KEY,
        "cx": GOOGLE_CSE_ID,
        "q": query,
        "num": 5,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()
                results = []
                for item in data.get("items", [])[:5]:
                    display_link = item.get("displayLink", "")
                    results.append({
                        "title": item.get("title", ""),
                        "url": item.get("link", ""),
                        "source": display_link,
                    })
                return results
    except Exception:
        return []


async def search_youtube(query: str) -> list[dict]:
    """Search YouTube Data API v3 for repair videos."""
    if not YOUTUBE_API_KEY:
        return []
    url = "https://www.googleapis.com/youtube/v3/search"
    params = {
        "key": YOUTUBE_API_KEY,
        "q": query + " repair tutorial",
        "part": "snippet",
        "type": "video",
        "maxResults": 5,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()
                results = []
                for item in data.get("items", [])[:5]:
                    video_id = item["id"].get("videoId", "")
                    snippet = item.get("snippet", {})
                    results.append({
                        "title": snippet.get("title", ""),
                        "url": f"https://www.youtube.com/watch?v={video_id}",
                        "thumbnail": snippet.get("thumbnails", {}).get("medium", {}).get("url", ""),
                        "channel": snippet.get("channelTitle", ""),
                    })
                return results
    except Exception:
        return []


async def search_guides(query: str) -> list[dict]:
    """Search Google Custom Search for repair guides."""
    if not GOOGLE_CSE_API_KEY or not GOOGLE_CSE_ID:
        return []
    url = "https://www.googleapis.com/customsearch/v1"
    params = {
        "key": GOOGLE_CSE_API_KEY,
        "cx": GOOGLE_CSE_ID,
        "q": query + " repair guide how to fix",
        "num": 5,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()
                results = []
                for item in data.get("items", [])[:5]:
                    results.append({
                        "title": item.get("title", ""),
                        "url": item.get("link", ""),
                        "snippet": item.get("snippet", ""),
                    })
                return results
    except Exception:
        return []
