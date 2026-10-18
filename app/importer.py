"""Read a pasted product link: the product photo plus whatever facts the shop publishes.

Shops put schema.org "Product" data (JSON-LD) on product pages for search engines: name, brand,
colour, material, price. Reading it gives the stylist real facts instead of guesses. We read only
the single page the user pasted. We never crawl or scrape search results.

Safety: only public hosts (every redirect is re-checked, so a link can't reach our own network),
and every download is streamed with a hard size cap.
"""
import html as htmllib
import ipaddress
import json
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import HTTPException

MAX_PAGE = 2 * 1024 * 1024
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; neorbot/0.1; +https://neor-closet.web.app)",
           "Accept": "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8"}


def is_public(url: str) -> bool:
    """Only fetch public http(s) hosts, so a pasted link can't reach our own network."""
    parts = urlparse(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    try:
        addrs = {info[4][0] for info in socket.getaddrinfo(parts.hostname, None)}
    except socket.gaierror:
        return False
    return all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addrs)


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=15, follow_redirects=False, headers=HEADERS)


async def fetch(http: httpx.AsyncClient, url: str, limit: int) -> tuple[httpx.Response, bytes, str]:
    """GET with manual redirects (each hop re-checked) and a streamed size cap. Returns (response, body, final url)."""
    for _ in range(5):
        if not is_public(url):
            raise HTTPException(400, "That link doesn't point to a public web page")
        async with http.stream("GET", url) as res:
            if res.is_redirect and "location" in res.headers:
                url = urljoin(url, res.headers["location"])
                continue
            body = bytearray()
            async for chunk in res.aiter_bytes():
                body.extend(chunk)
                if len(body) > limit:
                    raise HTTPException(413, "That file is too large for us to read")
            return res, bytes(body), url
    raise HTTPException(400, "That link redirects too many times")


def meta(page: str, *keys: str) -> str | None:
    for tag in re.findall(r"<meta\b[^>]*>", page, flags=re.I):
        attrs = dict((k.lower(), v) for k, _, v in re.findall(r'([\w:-]+)\s*=\s*(["\'])(.*?)\2', tag, flags=re.S))
        if (attrs.get("property") or attrs.get("name") or "").lower() in keys and attrs.get("content"):
            return htmllib.unescape(attrs["content"]).strip()
    return None


def _walk(node):
    """Yield every dict in a JSON-LD tree (handles @graph, lists and nesting)."""
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def _text(v) -> str | None:
    if isinstance(v, dict):
        v = v.get("name") or v.get("url") or v.get("@id")
    if isinstance(v, list):
        v = next((_text(x) for x in v if _text(x)), None)
    return htmllib.unescape(str(v)).strip()[:200] if v not in (None, "") else None


def product_jsonld(page: str) -> dict:
    """The first schema.org Product on the page, flattened. Empty dict if there isn't one."""
    for raw in re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', page, flags=re.I | re.S):
        try:
            data = json.loads(raw.strip())
        except ValueError:
            continue
        for node in _walk(data):
            kind = node.get("@type")
            if kind == "Product" or (isinstance(kind, list) and "Product" in kind):
                offers = node.get("offers") or {}
                offer = next(iter(_walk(offers)), {}) if offers else {}
                price = offer.get("price") or offer.get("lowPrice")
                return {k: v for k, v in {
                    "name": _text(node.get("name")),
                    "brand": _text(node.get("brand")),
                    "color": _text(node.get("color")),
                    "material": _text(node.get("material")),
                    "image": _text(node.get("image")),
                    "price": str(price) if price not in (None, "") else None,
                    "currency": _text(offer.get("priceCurrency")),
                }.items() if v}
    return {}


def parse_product_page(page: str, base_url: str) -> dict:
    """Everything we can learn from the page: structured data first, then og: tags, then <title>."""
    ld = product_jsonld(page)
    title = ld.get("name") or meta(page, "og:title", "twitter:title")
    if not title:
        m = re.search(r"<title[^>]*>(.*?)</title>", page, flags=re.I | re.S)
        title = htmllib.unescape(m.group(1)).strip() if m else None
    image = ld.get("image") or meta(page, "og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")
    return {
        "title": (title or "")[:120],
        "price": ld.get("price") or meta(page, "product:price:amount", "og:price:amount"),
        "currency": ld.get("currency") or meta(page, "product:price:currency", "og:price:currency"),
        "brand": ld.get("brand"),
        "material": ld.get("material"),
        "color": ld.get("color"),
        "image_url": urljoin(base_url, image) if image else None,
        "structured": bool(ld),
    }
