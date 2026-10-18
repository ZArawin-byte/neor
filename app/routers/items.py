"""Closet items, link import and the starter closet. Owner: core lane."""
import base64
import html as htmllib
import ipaddress
import json
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from .. import store
from ..deps import current_user
from ..schemas import ItemIn, ItemPatch
from ..seed import STARTER_CLOSET
from ..uploads import IMAGE_TYPES, MAX_UPLOAD, read_image

router = APIRouter()


@router.get("/api/items")
def list_items(uid: str = Depends(current_user)):
    return store.list_items(uid)


@router.post("/api/items")
async def add_item(meta: str = Form(...), file: UploadFile | None = File(default=None),
                   uid: str = Depends(current_user)):
    try:
        item = ItemIn.model_validate(json.loads(meta)).model_dump(exclude_none=True, mode="json")
    except (ValueError, TypeError) as e:  # bad JSON or a field that fails validation
        raise HTTPException(422, f"That item's details aren't valid: {e}")
    if file is not None and file.filename:
        data, ext, ctype = await read_image(file)
        return store.add_item(uid, item, data, ext, ctype)
    return store.add_item(uid, item)


@router.patch("/api/items/{item_id}")
def patch_item(item_id: str, patch: ItemPatch, uid: str = Depends(current_user)):
    if not store.update_item(uid, item_id, patch.model_dump(exclude_unset=True, mode="json")):
        raise HTTPException(404, "Item not found")
    return {"ok": True}


@router.post("/api/items/{item_id}/worn")
def mark_worn(item_id: str, uid: str = Depends(current_user)):
    """One more wear: feeds cost-per-wear on the orders page and the stylist's 'most worn' signal."""
    item = store.get_item(uid, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    count = int(item.get("wear_count") or 0) + 1
    store.update_item(uid, item_id, {"wear_count": count})
    return {"ok": True, "wear_count": count}


@router.delete("/api/items/{item_id}")
def remove_item(item_id: str, uid: str = Depends(current_user)):
    if not store.delete_item(uid, item_id):
        raise HTTPException(404, "Item not found")
    return {"ok": True}


class ImportReq(BaseModel):
    url: str


def _is_public(url: str) -> bool:
    """Only fetch public http(s) hosts, so a pasted link can't reach our own network."""
    parts = urlparse(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    try:
        addrs = {info[4][0] for info in socket.getaddrinfo(parts.hostname, None)}
    except socket.gaierror:
        return False
    return all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addrs)


async def _fetch(http: httpx.AsyncClient, url: str) -> httpx.Response:
    # Follow redirects by hand so every hop gets the same public-host check.
    for _ in range(5):
        if not _is_public(url):
            raise HTTPException(400, "That link doesn't point to a public web page")
        res = await http.get(url)
        if res.is_redirect and "location" in res.headers:
            url = urljoin(url, res.headers["location"])
            continue
        return res
    raise HTTPException(400, "That link redirects too many times")


def _meta(page: str, *keys: str) -> str | None:
    for tag in re.findall(r"<meta\b[^>]*>", page, flags=re.I):
        attrs = dict((k.lower(), v) for k, _, v in re.findall(r'([\w:-]+)\s*=\s*(["\'])(.*?)\2', tag, flags=re.S))
        if (attrs.get("property") or attrs.get("name") or "").lower() in keys and attrs.get("content"):
            return htmllib.unescape(attrs["content"]).strip()
    return None


@router.post("/api/items/import")
async def import_from_link(req: ImportReq, uid: str = Depends(current_user)):
    """Paste a product link: we read the page's main image (og:image) and title, and hand the
    image back so the browser can cut it out and tag it like any other upload."""
    url = req.url.strip()
    headers = {"User-Agent": "Mozilla/5.0 (compatible; NeorBot/0.1; +https://neor.web.app)",
               "Accept": "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8"}
    async with httpx.AsyncClient(timeout=15, follow_redirects=False, headers=headers) as http:
        try:
            page = await _fetch(http, url)
        except httpx.HTTPError:
            raise HTTPException(502, "Couldn't open that link")
        if page.status_code >= 400:
            raise HTTPException(502, "That shop wouldn't let us read the page. Save the photo and upload it instead.")

        title, price, image_url = None, None, url
        if not page.headers.get("content-type", "").startswith("image/"):
            body = page.text[:600_000]
            image_url = _meta(body, "og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")
            title = _meta(body, "og:title", "twitter:title")
            price = _meta(body, "product:price:amount", "og:price:amount")
            if not title:
                m = re.search(r"<title[^>]*>(.*?)</title>", body, flags=re.I | re.S)
                title = htmllib.unescape(m.group(1)).strip() if m else None
            if not image_url:
                raise HTTPException(422, "Couldn't find a product photo on that page. Save the photo and upload it instead.")
            image_url = urljoin(url, image_url)
            try:
                img = await _fetch(http, image_url)
            except httpx.HTTPError:
                raise HTTPException(502, "Found the product, but couldn't download its photo")
        else:
            img = page

    ctype = img.headers.get("content-type", "").split(";")[0].strip()
    if ctype not in IMAGE_TYPES:
        raise HTTPException(415, "That photo is in a format we can't use (we need JPG, PNG or WebP)")
    if len(img.content) > MAX_UPLOAD:
        raise HTTPException(413, "That photo is too large (8MB max)")
    return {
        "title": (title or "")[:120],
        "price": price,
        "source": url,
        "image": f"data:{ctype};base64,{base64.b64encode(img.content).decode()}",
    }


@router.post("/api/items/starter")
def starter_closet(uid: str = Depends(current_user)):
    # Calling this twice used to add 8 duplicates; now it hands back the starter pieces you already have.
    existing = [i for i in store.list_items(uid) if i.get("starter")]
    if existing:
        return existing
    return [store.add_item(uid, {**i, "starter": True}) for i in STARTER_CLOSET]
