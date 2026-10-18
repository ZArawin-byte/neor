"""Every AI-backed route: photo tagging, outfits, weak spots, shopping chat, care, places. Owner: AI lane."""
import random

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from .. import ai, store
from ..budget import budget_left
from ..deps import current_user
from ..seed import CATALOG_BY_ID
from ..uploads import read_image

router = APIRouter()


@router.post("/api/items/analyze")
async def analyze_item(file: UploadFile = File(...), uid: str = Depends(current_user)):
    profile = store.get_profile(uid)
    if profile.get("ai_consent") is False:
        return {"name": "", "category": "top", "ai": "disabled by user"}
    data, _, ctype = await read_image(file)
    return ai.tag_item(data, ctype)


class OutfitReq(BaseModel):
    occasion: str
    place: str = ""
    season: str = ""
    travel: str = ""


@router.post("/api/ai/outfit")
def ai_outfit(req: OutfitReq, uid: str = Depends(current_user)):
    return ai.outfit(store.get_profile(uid), store.list_items(uid), req.occasion, req.place, req.season, req.travel)


@router.post("/api/ai/weak-spots")
def ai_weak_spots(uid: str = Depends(current_user)):
    return ai.weak_spots(store.get_profile(uid), store.list_items(uid))


class ShopReq(BaseModel):
    message: str
    history: list[dict] = []


@router.post("/api/ai/shop")
def ai_shop(req: ShopReq, uid: str = Depends(current_user)):
    profile = store.get_profile(uid)
    return ai.shop_chat(profile, store.list_items(uid), req.history, req.message, budget_left(uid, profile))


class CareReq(BaseModel):
    item_id: str | None = None
    catalog_id: str | None = None


@router.post("/api/ai/care")
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


@router.post("/api/ai/places")
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
