"""The bargain market (souq): identify a find from a photo, compare online offers, find shops
near you, and keep a shared ledger of what people actually paid.

Adapted from the souq-source prototype to Neor's API, auth and storage. Google Vision and
SerpAPI are optional; without them, city search and nearby shops fall back to OpenStreetMap
and the ledger still works.
"""
import asyncio
import base64
import datetime as dt
import hashlib
import json
import math
import re
import time
import unicodedata
import uuid
from collections import OrderedDict
from decimal import Decimal
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import config, store

COUNTRIES = {"us": "USD", "gb": "GBP", "ma": "MAD", "fr": "EUR", "de": "EUR", "es": "EUR", "it": "EUR", "ca": "CAD", "au": "AUD", "jp": "JPY", "in": "INR", "th": "THB", "tr": "TRY", "mx": "MXN"}
_cache = OrderedDict()
_limits = OrderedDict()
_osm_cache = OrderedDict()
_osm_lock = asyncio.Lock()
_osm_next = 0.0
OSM_HEADERS = {"User-Agent": "Neor-hackathon-app/0.1 (bargain market)", "Accept": "application/json"}
# What to look for near you, per category, when there's no SerpAPI key.
NEARBY = {
    "all": ("shop", "^(clothes|second_hand|charity|boutique|shoes|bag|fashion_accessories|department_store|variety_store)$"),
    "secondhand": ("shop", "^(second_hand|charity)$"),
    "clothes": ("shop", "^(clothes|boutique|fashion|department_store)$"),
    "shoes": ("shop", "^shoes$"),
    "bags": ("shop", "^(bag|leather|fashion_accessories)$"),
    "market": ("amenity", "^marketplace$"),
    "gifts": ("shop", "^(gift|souvenir|craft|art)$"),
    "general": ("shop", "^(department_store|variety_store|supermarket|chemist|general|houseware|hardware|gift|discount)$"),
}


def safe_url(value):
    if not isinstance(value, str):
        return None
    try:
        p = urlparse(value)
        if p.scheme != "https" or not p.hostname or p.username or p.password:
            return None
        if p.hostname == "serpapi.com" or p.hostname.endswith(".serpapi.com"):
            return None
        if any(re.search(r"api.?key|token|secret|authorization|credential", k, re.I) for k in parse_qs(p.query)):
            return None
        if any(k and k in unquote(value) for k in (config.SERPAPI_API_KEY, config.GOOGLE_VISION_API_KEY)):
            return None
        return value
    except ValueError:
        return None


def clean(value, length=240):
    text = re.sub(r"<[^>]*>", "", str(value or ""))
    for key in (config.SERPAPI_API_KEY, config.GOOGLE_VISION_API_KEY):
        if key:
            text = text.replace(key, "[redacted]")
    return " ".join(text.split())[:length]


def throttle(uid):
    now = time.monotonic()
    started, count = _limits.get(uid, (now, 0))
    if now - started > 60:
        started, count = now, 0
    _limits[uid] = (started, count + 1)
    if len(_limits) > 500:
        _limits.popitem(last=False)
    if count >= 20:
        raise HTTPException(429, "Please wait a minute before searching again.")


async def provider(url, *, params=None, payload=None, headers=None):
    try:
        async with httpx.AsyncClient(timeout=35) as client:
            async with client.stream("POST" if payload else "GET", url, params=params, json=payload, headers=headers) as response:
                chunks = bytearray()
                async for chunk in response.aiter_bytes():
                    chunks.extend(chunk)
                    if len(chunks) > 4_000_000:
                        raise HTTPException(502, "Search response was too large. Try a narrower search.")
                if response.status_code == 429:
                    raise HTTPException(429, "The search provider's allowance has been reached. Try later.")
                if response.status_code >= 400:
                    raise HTTPException(502, "Search provider unavailable. Check the server's API configuration.")
                result = json.loads(chunks)
                if isinstance(result, dict) and result.get("error"):
                    raise HTTPException(502, "The provider could not complete the search. Check server configuration or try another query.")
                return result
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "Search is temporarily unavailable. Please try again.") from None


class Search(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=2, max_length=180)
    city: str = Field(default="", max_length=120)
    country: str = "us"
    lat: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    lon: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)

    @model_validator(mode="after")
    def valid(self):
        if self.country not in COUNTRIES or not self.query.strip() or (self.lat is None) != (self.lon is None):
            raise ValueError("Choose a supported country, query, and valid location.")
        return self


def distance(lat, lon, other_lat, other_lon):
    a, b = math.radians(lat), math.radians(other_lat)
    h = math.sin((b-a)/2)**2 + math.cos(a)*math.cos(b)*math.sin(math.radians(other_lon-lon)/2)**2
    return 12742 * math.asin(math.sqrt(min(1, h)))


async def search(req, engine):
    if not config.SERPAPI_API_KEY:
        raise HTTPException(503, "Live search needs SERPAPI_API_KEY on the Neor server. Reports still work.")
    params = {"engine": engine, "q": req.query, "gl": req.country, "hl": "en", "api_key": config.SERPAPI_API_KEY}
    if engine == "google_maps":
        params["type"] = "search"
        if req.lat is not None:
            params["ll"] = f"@{req.lat:.3f},{req.lon:.3f},13z"
            params["q"] += " near me"
        elif req.city:
            params["q"] += " " + req.city
    elif req.city:
        params["location"] = req.city
    cache_key = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
    cached = _cache.get(cache_key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    raw = await provider("https://serpapi.com/search.json", params=params)
    _cache[cache_key] = (time.monotonic()+600, raw)
    if len(_cache) > 100:
        _cache.popitem(last=False)
    return raw


STOPWORDS = {"the", "and", "for", "with", "set", "new", "pack", "of", "a", "an", "in", "on"}


def tokens(text):
    return [t for t in re.findall(r"[a-z0-9]+", unicodedata.normalize("NFKC", text).casefold()) if len(t) > 2 and t not in STOPWORDS]


def quantile(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    i = (len(xs) - 1) * q
    lo, hi = math.floor(i), math.ceil(i)
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)


def trimmed(xs):
    """Drop outliers (Tukey fences) once there's enough data to tell what an outlier is."""
    if len(xs) < 5:
        return sorted(xs)
    q1, q3 = quantile(xs, .25), quantile(xs, .75)
    fence = 1.5 * (q3 - q1)
    return sorted(x for x in xs if q1 - fence <= x <= q3 + fence)


def nice(x):
    """Round to a price a person would actually say at a stall."""
    if x is None:
        return None
    step = .5 if x < 10 else 1 if x < 100 else 5 if x < 1000 else 10 if x < 10000 else 100
    return round(round(x / step) * step, 2)


USED = re.compile(r"used|pre-?owned|second.?hand|refurb|open box", re.I)


def parse_offers(raw):
    rows = list(raw.get("shopping_results", [])) + list(raw.get("inline_shopping_results", []))
    for group in raw.get("categorized_shopping_results", [])[:12]:
        rows.extend(group.get("shopping_results", []))
    offers, seen = [], set()
    for row in rows[:240]:
        url = safe_url(row.get("product_link") or row.get("link"))
        title, seller = clean(row.get("title")), clean(row.get("source"), 120)
        if not url or not title or not seller or (title, seller, url) in seen:
            continue
        seen.add((title, seller, url))
        value = row.get("extracted_price")
        condition = clean(row.get("second_hand_condition"))
        offers.append({"id": str(len(offers)), "title": title, "seller": seller, "url": url, "price": clean(row.get("price")) or "See listing",
                       "value": float(value) if isinstance(value, (int, float)) and math.isfinite(value) and value > 0 else None,
                       "used": bool(condition or USED.search(title)),
                       "image": safe_url(row.get("thumbnail")), "rating": row.get("rating") if isinstance(row.get("rating"), (int, float)) else None,
                       "details": clean(row.get("snippet"), 600), "delivery": clean(row.get("delivery")), "condition": condition,
                       "nearby": bool(re.search(r"nearby|in store|pick ?up", clean(row.get("delivery")) + " " + " ".join(map(str, row.get("extensions", []) or [])), re.I))})
        if len(offers) == 40:
            break
    return offers


def reports_like(query, currency, lat=None, lon=None, radius_km=30):
    """Ledger rows for (roughly) this item: at least half the query words in its name/brand/model."""
    want = set(tokens(query))
    if not want:
        return []
    found = []
    for r in store.souq_reports_recent():
        d = r["data"]
        if d.get("currency") != currency:
            continue
        have = set(tokens(" ".join(str(d.get(k, "")) for k in ("product_name", "brand", "model", "variant"))))
        if len(want & have) * 2 < len(want):
            continue
        shop = d.get("shop", {})
        if lat is not None and isinstance(shop.get("lat"), (int, float)) and distance(lat, lon, shop["lat"], shop["lon"]) > radius_km:
            continue
        found.append(r)
    return found


def fmt(x):
    x = nice(x)
    return f"{x:,.0f}" if x == int(x) else f"{x:,.2f}"


def verdict(new_prices, paid, currency):
    """What to accept, and why, in words. None when there's nothing to go on."""
    new = trimmed(new_prices)
    basis = []
    if new:
        basis.append(f"{len(new)} new listings online: most between {fmt(quantile(new, .25))} and {fmt(quantile(new, .75))} {currency}, typical {fmt(quantile(new, .5))}.")
    if paid:
        basis.append(f"{len(paid)} {'person' if len(paid) == 1 else 'people'} near you paid {fmt(min(paid))}" + (f" to {fmt(max(paid))}" if len(paid) > 1 else "") + f" {currency}.")
    if len(paid) >= 3:
        low, high = quantile(paid, .25), quantile(paid, .75)
        source = "what people actually paid nearby"
    elif paid and new:
        mid = quantile(paid, .5)
        low, high = min(mid, quantile(new, .25)), max(mid, quantile(new, .5))
        source = "a few local purchases, checked against online prices"
    elif len(new) >= 3:
        low, high = quantile(new, .25), quantile(new, .5)
        source = "the cheaper half of what shops ask online"
    elif new:
        low, high = min(new) * .85, max(new)
        source = "only a couple of online listings, so treat this loosely"
    elif paid:
        low, high = min(paid), max(paid) if len(paid) > 1 else paid[0] * 1.15
        source = "what one or two people paid nearby"
    else:
        return None
    if high <= low:
        high = low * 1.15
    # When locals have paid a lot less than shops ask online, their prices set the ceiling.
    walk = high * 1.25 if len(paid) >= 3 else max(high * 1.1, quantile(new, .75) or 0) if new else high * 1.2
    confidence = "good" if len(paid) >= 3 or len(new) >= 10 else "fair" if len(new) >= 4 or paid else "rough"
    return {"currency": currency, "open_at": nice(low * .75), "low": nice(low), "high": nice(high), "walk_away": nice(walk),
            "confidence": confidence, "source": source, "basis": basis}


class Spot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)


class Place(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=2, max_length=120)


class Near(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)
    category: str = "all"

    @field_validator("category")
    @classmethod
    def known(cls, value):
        if value not in NEARBY:
            raise ValueError("Choose a known category.")
        return value


async def osm(params, endpoint="search"):
    """Nominatim asks for at most one request a second, so requests share one slot and a cache."""
    global _osm_next
    key = endpoint + json.dumps(params, sort_keys=True)
    hit = _osm_cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    async with _osm_lock:
        wait = _osm_next - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _osm_next = time.monotonic() + 1.2
        try:
            async with httpx.AsyncClient(timeout=15, headers=OSM_HEADERS) as client:
                res = await client.get(f"https://nominatim.openstreetmap.org/{endpoint}", params=params)
                res.raise_for_status()
                data = res.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(502, "Map search is busy right now. Try again in a moment.") from None
    _osm_cache[key] = (time.monotonic() + 3600, data)
    if len(_osm_cache) > 200:
        _osm_cache.popitem(last=False)
    return data


class Shop(BaseModel):
    id: str = Field(pattern=r"^(?:(node|way|relation)/\d{1,16}|google/[A-Za-z0-9_:-]{3,220})$")
    name: str = Field(min_length=1, max_length=120)
    address: str = Field(default="", max_length=240)
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)


class Report(BaseModel):
    model_config = ConfigDict(extra="forbid")
    submission_id: uuid.UUID
    shop: Shop
    product_name: str = Field(min_length=3, max_length=140)
    brand: str = Field(default="", max_length=80)
    model: str = Field(default="", max_length=100)
    variant: str = Field(default="", max_length=180)
    currency: str = Field(pattern=r"^(MAD|USD|EUR|GBP|JPY|THB|VND|MXN|TRY|IDR|INR|CNY|AED|CAD|AUD)$")
    paid: Decimal = Field(gt=0, le=1000000, decimal_places=2)
    asking: Decimal | None = Field(default=None, gt=0, le=1000000, decimal_places=2)
    purchase_date: dt.date
    notes: str = Field(default="", max_length=600)
    photo: str | None = Field(default=None, max_length=1_050_000)

    @field_validator("product_name", "brand", "model", "variant", "notes")
    @classmethod
    def trim(cls, value):
        return " ".join(unicodedata.normalize("NFKC", value).split())

    @model_validator(mode="after")
    def valid(self):
        if len(self.product_name) < 3 or self.purchase_date < dt.date(2000, 1, 1) or self.purchase_date > dt.datetime.now(dt.timezone.utc).date():
            raise ValueError("Enter an item name and a valid past purchase date.")
        if self.asking is not None and self.paid > self.asking:
            raise ValueError("Paid price cannot exceed asking price.")
        if self.photo:
            try:
                if not base64.b64decode(self.photo, validate=True).startswith(b"\xff\xd8\xff"):
                    raise ValueError()
            except ValueError:
                raise ValueError("Attach a smaller JPEG photo.") from None
        return self


def public_report(row, uid):
    data = dict(row["data"])
    data.pop("payload_hash", None)
    data.pop("submission_id", None)
    return {**data, "id": row["id"], "is_mine": row["user_id"] == uid,
            "photo_url": store.image_url(row.get("image_path")), "availability": "Past purchase; current stock unverified"}


def router(current_user, read_image):
    routes = APIRouter(prefix="/api/souq", tags=["souq"], dependencies=[Depends(current_user)])

    @routes.get("/config")
    def capabilities():
        return {"vision": bool(config.GOOGLE_VISION_API_KEY), "shopping": bool(config.SERPAPI_API_KEY), "countries": COUNTRIES}

    @routes.post("/identify")
    async def identify(file: UploadFile = File(...), uid: str = Depends(current_user)):
        throttle(uid)
        if store.get_profile(uid).get("ai_consent") is False:
            raise HTTPException(403, "Photo identification is disabled in your profile.")
        if not config.GOOGLE_VISION_API_KEY:
            raise HTTPException(503, "Photo identification needs GOOGLE_VISION_API_KEY on the Neor server.")
        image, _, _ = await read_image(file)
        if not (image.startswith(b"\xff\xd8\xff") or image.startswith(b"\x89PNG\r\n\x1a\n") or (image.startswith(b"RIFF") and image[8:12] == b"WEBP")):
            raise HTTPException(415, "Choose a real JPG, PNG or WebP image.")
        raw = await provider("https://vision.googleapis.com/v1/images:annotate", headers={"X-Goog-Api-Key": config.GOOGLE_VISION_API_KEY}, payload={"requests": [{"image": {"content": base64.b64encode(image).decode()}, "features": [{"type": t, "maxResults": 8} for t in ("WEB_DETECTION", "LABEL_DETECTION", "OBJECT_LOCALIZATION", "LOGO_DETECTION", "TEXT_DETECTION")]}]})
        result = (raw.get("responses") or [{}])[0]
        if result.get("error"):
            raise HTTPException(502, "Google could not identify this image. Check Vision activation, billing and quota.")
        web = result.get("webDetection", {})
        guesses = web.get("bestGuessLabels") or result.get("localizedObjectAnnotations") or result.get("labelAnnotations") or [{}]
        first = guesses[0]
        name = clean(first.get("label") or first.get("name") or first.get("description"), 140)
        logos = [x for x in result.get("logoAnnotations", []) if x.get("score", 0) >= .75]
        ocr = result.get("fullTextAnnotation", {}).get("text", "")
        model = re.search(r"\b(?:model|sku|item\s*(?:no|number))[: #.-]*([A-Za-z0-9][A-Za-z0-9-]{2,40})", ocr, re.I)
        return {"name": name, "brand": clean(logos[0].get("description"), 80) if logos else "", "model": model[1] if model else "",
                "pages": [{"title": clean(p.get("pageTitle")) or "Matching page", "url": safe_url(p.get("url"))} for p in web.get("pagesWithMatchingImages", [])[:6] if safe_url(p.get("url"))],
                "similar": [safe_url(p.get("url")) for p in web.get("visuallySimilarImages", [])[:8] if safe_url(p.get("url"))]}

    @routes.post("/shopping")
    async def shopping(req: Search, uid: str = Depends(current_user)):
        throttle(uid)
        return {"offers": parse_offers(await search(req, "google_shopping")),
                "notice": "Retailer online offers. Exact variant, total price and branch stock are unconfirmed."}

    @routes.post("/paid")
    def paid_nearby(req: Search, uid: str = Depends(current_user)):
        """Just the ledger matches for an item near a place: cheap enough to poll for a live map."""
        rows = reports_like(req.query, COUNTRIES[req.country], req.lat, req.lon)
        return {"paid": [public_report(r, uid) for r in rows[:60]]}

    @routes.post("/estimate")
    async def estimate(req: Search, uid: str = Depends(current_user)):
        """Price check: online listings + what people paid nearby -> a range to accept, with reasons."""
        throttle(uid)
        currency = COUNTRIES[req.country]
        offers, online_note = [], ""
        if config.SERPAPI_API_KEY:
            offers = parse_offers(await search(req, "google_shopping"))
        else:
            online_note = "Online prices are off: the server has no SERPAPI_API_KEY, so this uses the price ledger only."
        rows = reports_like(req.query, currency, req.lat, req.lon)
        paid = [float(r["data"]["paid"]) for r in rows]
        return {
            "currency": currency,
            "verdict": verdict([o["value"] for o in offers if o["value"] and not o["used"]], paid, currency),
            "offers": offers[:24],
            "paid": [public_report(r, uid) for r in rows[:60]],
            "online_note": online_note,
            "notice": "An estimate from listings and past purchases, not a valuation. Condition, size and authenticity change what something is worth.",
        }

    @routes.post("/stores")
    async def stores(req: Search, uid: str = Depends(current_user)):
        throttle(uid)
        raw = await search(req, "google_maps")
        found = {}
        for row in raw.get("local_results", []) + ([raw["place_results"]] if raw.get("place_results") else []):
            gps = row.get("gps_coordinates", {})
            lat, lon = gps.get("latitude"), gps.get("longitude")
            identity = clean(row.get("place_id") or row.get("data_id"), 220)
            if not re.fullmatch(r"[A-Za-z0-9_:-]{3,220}", identity) or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or not math.isfinite(lat) or not math.isfinite(lon) or abs(lat) > 90 or abs(lon) > 180:
                continue
            if req.lat is not None and distance(req.lat, req.lon, lat, lon) > 12:
                continue
            found[identity] = {"id": "google/"+identity, "name": clean(row.get("title"), 120), "address": clean(row.get("address")), "lat": lat, "lon": lon, "website": safe_url(row.get("website"))}
        return {"stores": list(found.values())[:24], "notice": "Real Google Maps locations. Product inventory and branch prices are unconfirmed."}

    @routes.post("/geocode")
    async def geocode(req: Place, uid: str = Depends(current_user)):
        throttle(uid)
        raw = await osm({"q": req.query.strip(), "format": "jsonv2", "limit": 5, "addressdetails": 1, "accept-language": "en"})
        places = [{"name": clean(r.get("display_name")), "lat": float(r["lat"]), "lon": float(r["lon"]),
                   "country": (r.get("address") or {}).get("country_code", "")}
                  for r in raw if r.get("lat") and r.get("lon")]
        return {"places": places, "source": "OpenStreetMap contributors"}

    @routes.post("/reverse")
    async def reverse(req: Spot, uid: str = Depends(current_user)):
        """Which town and country a (rounded) location is in, so prices use the local currency."""
        throttle(uid)
        r = await osm({"lat": round(req.lat, 3), "lon": round(req.lon, 3), "format": "jsonv2", "zoom": 12, "addressdetails": 1,
                       "accept-language": "en"}, endpoint="reverse")
        a = r.get("address") or {}
        town = a.get("city") or a.get("town") or a.get("village") or a.get("suburb") or a.get("county") or ""
        return {"name": clean(", ".join(x for x in (town, a.get("state") or a.get("country")) if x)) or "Near you",
                "country": a.get("country_code", "")}

    @routes.post("/nearby")
    async def nearby(req: Near, uid: str = Depends(current_user)):
        """Shops within ~3km from OpenStreetMap (Overpass). Works without any API key."""
        throttle(uid)
        key = f"{req.lat:.3f},{req.lon:.3f},{req.category}"
        hit = _osm_cache.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        tag, value = NEARBY[req.category]
        query = f"""[out:json][timeout:40];
        (node(around:3000,{req.lat},{req.lon})["{tag}"~"{value}"]["name"];
         way(around:3000,{req.lat},{req.lon})["{tag}"~"{value}"]["name"];);
        out center 80;"""
        raw = None
        # The public Overpass servers can take 20-30s under load; cached for 15 minutes after.
        async with httpx.AsyncClient(timeout=50, headers=OSM_HEADERS) as client:
            for mirror in ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"):
                try:
                    res = await client.post(mirror, data={"data": query})
                    res.raise_for_status()
                    raw = res.json()
                    break
                except (httpx.HTTPError, ValueError):
                    continue
        if raw is None:
            raise HTTPException(502, "The map's shop search is busy right now. Try again in a moment.")
        shops = []
        for el in raw.get("elements", []):
            t = el.get("tags", {})
            lat = el.get("lat") or el.get("center", {}).get("lat")
            lon = el.get("lon") or el.get("center", {}).get("lon")
            if lat is None or lon is None:
                continue
            street = " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x)
            shops.append({"id": f"{el['type']}/{el['id']}", "name": clean(t.get("name"), 120), "lat": lat, "lon": lon,
                          "address": clean(", ".join(x for x in (street, t.get("addr:city")) if x)),
                          "km": round(distance(req.lat, req.lon, lat, lon), 2),
                          "kind": clean((t.get("shop") or t.get("amenity") or "").replace("_", " "), 40),
                          "website": safe_url(t.get("website") or t.get("contact:website"))})
        shops.sort(key=lambda x: x["km"])
        data = {"stores": shops[:30], "notice": "Shops from OpenStreetMap. Not a complete list, and stock and prices aren't confirmed."}
        _osm_cache[key] = (time.monotonic() + 900, data)
        return data

    @routes.get("/reports")
    def reports(shop_id: str, q: str = "", uid: str = Depends(current_user)):
        rows = store.souq_reports(shop_id)
        tokens = clean(q, 140).casefold().split()
        selected = [r for r in rows if all(t in " ".join(str(r["data"].get(k, "")) for k in ("product_name", "brand", "model", "variant")).casefold() for t in tokens)]
        return {"reports": [public_report(r, uid) for r in selected[:250]], "truncated": len(selected) > 250}

    @routes.post("/reports")
    def create_report(req: Report, uid: str = Depends(current_user)):
        throttle(uid)
        data = req.model_dump(mode="json", exclude={"photo"})
        data["paid"] = float(req.paid)
        data["asking"] = float(req.asking) if req.asking else None
        data["payload_hash"] = hashlib.sha256(req.model_dump_json().encode()).hexdigest()
        normalized = [unicodedata.normalize("NFKC", v).casefold().strip() for v in (req.product_name, req.brand, req.model, req.variant or "unspecified:"+str(req.submission_id))]
        data["product_key"] = hashlib.sha256(json.dumps(normalized).encode()).hexdigest()
        data["created_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        image = base64.b64decode(req.photo) if req.photo else None
        row = store.souq_add_report(uid, data, image)
        return public_report(row, uid)

    @routes.delete("/reports/{report_id}")
    def remove_report(report_id: uuid.UUID, uid: str = Depends(current_user)):
        store.souq_delete_report(uid, str(report_id))
        return {"ok": True}

    return routes
