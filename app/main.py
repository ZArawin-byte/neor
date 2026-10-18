import base64
import datetime as dt
import html as htmllib
import ipaddress
import json
import random
import re
import secrets
import socket
import time
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ai, config, store
from .seed import CATALOG, CATALOG_BY_ID, STARTER_CLOSET

app = FastAPI(title="Neor API", description="Backend for Neor - step into your closet.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.FRONTEND_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
if not config.USE_SUPABASE:
    app.mount("/uploads", StaticFiles(directory=config.UPLOAD_DIR), name="uploads")

MAX_UPLOAD = 8 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


# ------------------------------------------------------------------ auth

_token_cache: dict[str, tuple[str, float]] = {}


def current_user(authorization: str = Header(default="")) -> str:
    if not config.USE_SUPABASE:
        return config.DEMO_USER_ID
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "Sign in first")
    cached = _token_cache.get(token)
    if cached and cached[1] > time.time():
        return cached[0]
    uid = store.user_id_from_token(token)
    if not uid:
        raise HTTPException(401, "Session expired")
    _token_cache[token] = (uid, time.time() + 300)
    return uid


# ------------------------------------------------------------------ meta

@app.get("/")
def health():
    return {"app": "neor", "ok": True, "docs": "/docs"}


@app.get("/api/config")
def public_config():
    # Anon key is designed to be public; the service-role key never leaves the server.
    return {
        "supabase_url": config.SUPABASE_URL if config.USE_SUPABASE else None,
        "supabase_anon_key": config.SUPABASE_ANON_KEY if config.USE_SUPABASE else None,
        "demo": not config.USE_SUPABASE,
        "ai": "groq" if config.USE_GROQ else "offline",
    }


# ------------------------------------------------------------------ profile

@app.get("/api/profile")
def get_profile(uid: str = Depends(current_user)):
    return store.get_profile(uid)


@app.put("/api/profile")
def put_profile(patch: dict, uid: str = Depends(current_user)):
    allowed = {"name", "styles", "modesty", "modesty_notes", "measurements", "budget", "scents",
               "colors_love", "colors_avoid", "climate", "theme", "onboarded", "accessories", "ai_consent",
               "age", "gender", "pronouns", "tradition", "dress_rules"}
    return store.save_profile(uid, {k: v for k, v in patch.items() if k in allowed})


async def _read_image(file: UploadFile) -> tuple[bytes, str, str]:
    if file.content_type not in IMAGE_TYPES:
        raise HTTPException(415, "Please upload a JPG, PNG or WebP image")
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Image too large (8MB max)")
    return data, IMAGE_TYPES[file.content_type], file.content_type


@app.post("/api/profile/mirror")
async def upload_mirror(file: UploadFile = File(...), uid: str = Depends(current_user)):
    data, ext, ctype = await _read_image(file)
    return store.save_mirror(uid, data, ext, ctype)


# ------------------------------------------------------------------ closet

@app.get("/api/items")
def list_items(uid: str = Depends(current_user)):
    return store.list_items(uid)


@app.post("/api/items/analyze")
async def analyze_item(file: UploadFile = File(...), uid: str = Depends(current_user)):
    profile = store.get_profile(uid)
    if profile.get("ai_consent") is False:
        return {"name": "", "category": "top", "ai": "disabled by user"}
    data, _, ctype = await _read_image(file)
    return ai.tag_item(data, ctype)


@app.post("/api/items")
async def add_item(meta: str = Form(...), file: UploadFile | None = File(default=None),
                   uid: str = Depends(current_user)):
    item = json.loads(meta)
    if file is not None and file.filename:
        data, ext, ctype = await _read_image(file)
        return store.add_item(uid, item, data, ext, ctype)
    return store.add_item(uid, item)


@app.patch("/api/items/{item_id}")
def patch_item(item_id: str, patch: dict, uid: str = Depends(current_user)):
    store.update_item(uid, item_id, patch)
    return {"ok": True}


@app.delete("/api/items/{item_id}")
def remove_item(item_id: str, uid: str = Depends(current_user)):
    store.delete_item(uid, item_id)
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


@app.post("/api/items/import")
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


@app.post("/api/items/starter")
def starter_closet(uid: str = Depends(current_user)):
    return [store.add_item(uid, {**i, "starter": True}) for i in STARTER_CLOSET]


# ------------------------------------------------------------------ AI

class OutfitReq(BaseModel):
    occasion: str
    place: str = ""
    season: str = ""
    travel: str = ""


@app.get("/api/catalog")
def catalog():
    return CATALOG


@app.post("/api/ai/outfit")
def ai_outfit(req: OutfitReq, uid: str = Depends(current_user)):
    return ai.outfit(store.get_profile(uid), store.list_items(uid), req.occasion, req.place, req.season, req.travel)


@app.post("/api/ai/weak-spots")
def ai_weak_spots(uid: str = Depends(current_user)):
    return ai.weak_spots(store.get_profile(uid), store.list_items(uid))


class ShopReq(BaseModel):
    message: str
    history: list[dict] = []


@app.post("/api/ai/shop")
def ai_shop(req: ShopReq, uid: str = Depends(current_user)):
    profile = store.get_profile(uid)
    return ai.shop_chat(profile, store.list_items(uid), req.history, req.message, _budget_left(uid, profile))


class CareReq(BaseModel):
    item_id: str | None = None
    catalog_id: str | None = None


@app.post("/api/ai/care")
def ai_care(req: CareReq, uid: str = Depends(current_user)):
    if req.catalog_id:
        item = CATALOG_BY_ID.get(req.catalog_id)
    else:
        item = next((i for i in store.list_items(uid) if i["id"] == req.item_id), None)
    if not item:
        raise HTTPException(404, "Item not found")
    return ai.care(item)


class PlacesReq(BaseModel):
    city: str
    vibe: str = "cozy cafe and pretty photo spots"


OSM_HEADERS = {"User-Agent": "Neor-hackathon-app/0.1 (DubHacks)"}


@app.post("/api/ai/places")
async def ai_places(req: PlacesReq, uid: str = Depends(current_user)):
    async with httpx.AsyncClient(timeout=25, headers=OSM_HEADERS) as http:
        geo = (await http.get("https://nominatim.openstreetmap.org/search",
                              params={"q": req.city, "format": "json", "limit": 1})).json()
        if not geo:
            raise HTTPException(404, "Couldn't find that place")
        lat, lon = float(geo[0]["lat"]), float(geo[0]["lon"])
        query = f"""[out:json][timeout:20];
        (node(around:1800,{lat},{lon})["amenity"="cafe"]["name"];
         node(around:2500,{lat},{lon})["tourism"~"viewpoint|artwork|attraction|museum|gallery"]["name"];
         way(around:2500,{lat},{lon})["leisure"~"park|garden"]["name"];
         node(around:1800,{lat},{lon})["shop"~"clothes|boutique|perfumery"]["name"];);
        out center 120;"""
        try:
            osm = (await http.post("https://overpass-api.de/api/interpreter", data={"data": query})).json()
        except Exception:
            osm = {"elements": []}
    candidates = []
    for el in osm.get("elements", []):
        tags = el.get("tags", {})
        clat = el.get("lat") or el.get("center", {}).get("lat")
        clon = el.get("lon") or el.get("center", {}).get("lon")
        if not clat:
            continue
        kind = tags.get("amenity") or tags.get("tourism") or tags.get("leisure") or tags.get("shop")
        candidates.append({"id": f"{el['type']}/{el['id']}", "name": tags["name"], "kind": kind,
                           "lat": clat, "lon": clon})
    random.shuffle(candidates)
    result = ai.places(req.city, req.vibe, candidates, store.get_profile(uid))
    by_id = {c["id"]: c for c in candidates}
    result["picks"] = [{**by_id[p["id"]], **p} for p in result["picks"]]
    result["center"] = [lat, lon]
    return result


# ------------------------------------------------------------------ Visa checkout

def _luhn(num: str) -> bool:
    total = 0
    for i, d in enumerate(reversed(num)):
        n = int(d)
        if i % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return total % 10 == 0


def _spent_this_month(uid: str) -> float:
    month = dt.date.today().strftime("%Y-%m")
    return sum(o.get("total", 0) for o in store.list_orders(uid) if o.get("created", "").startswith(month))


def _budget_left(uid: str, profile: dict) -> float | None:
    budget = profile.get("budget")
    if not budget:
        return None
    return round(float(budget) - _spent_this_month(uid), 2)


class Card(BaseModel):
    number: str
    exp: str  # MM/YY
    cvc: str
    name: str


class CheckoutReq(BaseModel):
    product_ids: list[str]
    card: Card
    confirm_over_budget: bool = False


@app.post("/api/checkout")
def checkout(req: CheckoutReq, uid: str = Depends(current_user)):
    products = [CATALOG_BY_ID[p] for p in req.product_ids if p in CATALOG_BY_ID]
    if not products:
        raise HTTPException(400, "Your bag is empty")

    number = "".join(c for c in req.card.number if c.isdigit())
    if not number.startswith("4") or len(number) not in (13, 16, 19) or not _luhn(number):
        raise HTTPException(402, "Neor accepts Visa only - please check your Visa card number")
    try:
        mm, yy = req.card.exp.split("/")
        exp = dt.date(2000 + int(yy), int(mm), 1)
    except Exception:
        raise HTTPException(402, "Expiry must be MM/YY")
    if exp < dt.date.today().replace(day=1):
        raise HTTPException(402, "This card has expired")
    if not (req.card.cvc.isdigit() and len(req.card.cvc) == 3):
        raise HTTPException(402, "CVV should be 3 digits")

    total = round(sum(p["price"] for p in products), 2)
    profile = store.get_profile(uid)
    left = _budget_left(uid, profile)
    if left is not None and total > left and not req.confirm_over_budget:
        raise HTTPException(409, f"This is ${total - left:.2f} over the budget you set. Confirm if you still want it.")

    # The full card number is never stored or logged: we keep only last4 and a
    # simulated network token, the way Visa Token Service replaces the PAN.
    order = {
        "created": dt.datetime.now().isoformat(timespec="seconds"),
        "items": [{"id": p["id"], "name": p["name"], "price": p["price"], "brand": p["brand"]} for p in products],
        "total": total,
        "card": {"network": "visa", "last4": number[-4:], "token": "vtok_" + secrets.token_hex(8)},
        "status": "confirmed",
        "points_earned": int(total),
    }
    saved = store.add_order(uid, order)
    store.save_profile(uid, {"points": profile.get("points", 0) + int(total)})

    # Post-purchase: the item walks straight into your closet, care guide attached.
    for p in products:
        store.add_item(uid, {
            "name": p["name"], "category": p["category"], "color": p["color"], "hex": p["hex"],
            "material": p["material"], "styles": p["styles"], "seasons": p["seasons"],
            "occasions": p["occasions"], "brand": p["brand"], "price": p["price"], "tier": p["tier"],
            "catalog_id": p["id"], "status": "arriving",
        })
    return saved


@app.get("/api/orders")
def orders(uid: str = Depends(current_user)):
    profile = store.get_profile(uid)
    return {"orders": store.list_orders(uid), "budget": profile.get("budget"),
            "spent_this_month": _spent_this_month(uid), "points": profile.get("points", 0)}


@app.delete("/api/me")
def forget_me(uid: str = Depends(current_user)):
    store.delete_everything(uid)
    return {"ok": True}
