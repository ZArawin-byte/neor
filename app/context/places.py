"""Real places from OpenStreetMap: Nominatim to find the city, Overpass (three mirrors) for spots near it."""
import time

import httpx

HEADERS = {"User-Agent": "neor-hackathon-app/0.1 (DubHacks)"}
NOMINATIM = "https://nominatim.openstreetmap.org/search"
OVERPASS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
OVERPASS_TIMEOUT = 12
TTL = 60 * 60
PASS_THROUGH = ("image", "wikimedia_commons", "website", "opening_hours")

_cache: dict[tuple[str, str], tuple[float, dict]] = {}


class PlacesUnavailable(Exception):
    pass


class PlaceNotFound(Exception):
    pass


def cached(city: str, vibe: str) -> dict | None:
    hit = _cache.get((city.strip().lower(), vibe.strip().lower()))
    return hit[1] if hit and hit[0] > time.time() else None


def remember(city: str, vibe: str, result: dict) -> None:
    _cache[(city.strip().lower(), vibe.strip().lower())] = (time.time() + TTL, result)


def _query(lat: float, lon: float) -> str:
    return f"""[out:json][timeout:10];
    (node(around:1800,{lat},{lon})["amenity"="cafe"]["name"];
     node(around:2500,{lat},{lon})["tourism"~"viewpoint|artwork|attraction|museum|gallery"]["name"];
     way(around:2500,{lat},{lon})["leisure"~"park|garden"]["name"];
     node(around:1800,{lat},{lon})["shop"~"clothes|boutique|perfumery|second_hand"]["name"];);
    out center 120;"""


def _candidate(el: dict) -> dict | None:
    tags = el.get("tags", {})
    lat = el.get("lat") or el.get("center", {}).get("lat")
    lon = el.get("lon") or el.get("center", {}).get("lon")
    if lat is None or lon is None or not tags.get("name"):
        return None
    kind = tags.get("amenity") or tags.get("tourism") or tags.get("leisure") or tags.get("shop") or "place"
    out = {"id": f"{el['type']}/{el['id']}", "name": tags["name"], "kind": kind, "lat": lat, "lon": lon}
    out.update({k: tags[k] for k in PASS_THROUGH if tags.get(k)})
    return out


async def search(city: str) -> tuple[list[float], list[dict], str | None]:
    """(center, candidates sorted deterministically, reason if every Overpass mirror failed)."""
    async with httpx.AsyncClient(headers=HEADERS) as http:
        try:
            geo = (await http.get(NOMINATIM, params={"q": city, "format": "json", "limit": 1}, timeout=10)).json()
        except Exception:
            raise PlacesUnavailable() from None
        if not geo:
            raise PlaceNotFound()
        lat, lon = float(geo[0]["lat"]), float(geo[0]["lon"])
        elements, reason = None, None
        for url in OVERPASS:
            try:
                resp = await http.post(url, data={"data": _query(lat, lon)}, timeout=OVERPASS_TIMEOUT)
                resp.raise_for_status()
                elements = resp.json().get("elements", [])
                break
            except Exception:
                continue
        if elements is None:
            reason = "Every OpenStreetMap server was busy, so no spots this time. Try again in a minute."
    seen, candidates = set(), []
    for el in elements or []:
        c = _candidate(el)
        if c and c["id"] not in seen:
            seen.add(c["id"])
            candidates.append(c)
    candidates.sort(key=lambda c: (c["kind"], c["name"].lower(), c["id"]))
    return [lat, lon], candidates, reason
