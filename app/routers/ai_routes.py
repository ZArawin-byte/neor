"""Every AI-backed route: photo tagging, outfits, weak spots, shopping chat, care, places. Owner: AI lane."""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, field_validator

from .. import ai, store
from ..context import places
from ..budget import budget_left
from ..deps import current_user
from ..seed import CATALOG_BY_ID
from ..uploads import read_image

router = APIRouter()


class _Capped(BaseModel):
    """Free text is capped at 200 characters before it can reach a prompt."""

    @field_validator("*", mode="before")
    @classmethod
    def _cap(cls, v):
        return ai.cap(v) if isinstance(v, str) else v


@router.post("/api/items/analyze")
async def analyze_item(file: UploadFile = File(...), uid: str = Depends(current_user)):
    data, _, ctype = await read_image(file)
    return ai.tag_item(data, ctype, store.get_profile(uid))


class OutfitReq(_Capped):
    occasion: str
    place: str = ""
    season: str = ""
    travel: str = ""
    pieces: list[str] = []  # closet ids already on the table / mirror (FRONTEND_SPEC 8.4)


@router.post("/api/ai/outfit")
def ai_outfit(req: OutfitReq, uid: str = Depends(current_user)):
    return ai.outfit(store.get_profile(uid), store.list_items(uid), req.occasion, req.place, req.season, req.travel,
                     req.pieces)


@router.post("/api/ai/weak-spots")
def ai_weak_spots(uid: str = Depends(current_user)):
    return ai.weak_spots(store.get_profile(uid), store.list_items(uid))


class ShopReq(_Capped):
    message: str
    history: list[dict] = []


@router.post("/api/ai/shop")
def ai_shop(req: ShopReq, uid: str = Depends(current_user)):
    profile = store.get_profile(uid)
    return ai.shop_chat(profile, store.list_items(uid), req.history[-ai.HISTORY_TURNS:], req.message,
                        budget_left(uid, profile))


class CareReq(BaseModel):
    item_id: str | None = None
    catalog_id: str | None = None


@router.post("/api/ai/care")
def ai_care(req: CareReq, uid: str = Depends(current_user)):
    owned = not req.catalog_id
    item = store.get_item(uid, req.item_id or "") if owned else CATALOG_BY_ID.get(req.catalog_id)
    if not item:
        raise HTTPException(404, "Item not found")
    return ai.care(item, store.get_profile(uid), owned=owned)


class PlacesReq(_Capped):
    city: str
    vibe: str = "cozy cafe and pretty photo spots"


@router.post("/api/ai/places")
async def ai_places(req: PlacesReq, uid: str = Depends(current_user)):
    hit = places.cached(req.city, req.vibe)
    if hit:
        return hit
    try:
        center, candidates, reason = await places.search(req.city)
    except places.PlacesUnavailable:
        raise HTTPException(503, "Places search is unavailable right now") from None
    except places.PlaceNotFound:
        raise HTTPException(404, "Couldn't find that place") from None
    result = ai.places(req.city, req.vibe, candidates, store.get_profile(uid), center)
    if reason:
        result["reason"] = reason
    elif result["picks"]:
        places.remember(req.city, req.vibe, result)
    return result
