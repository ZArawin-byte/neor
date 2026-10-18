"""Request models for the core-lane routes.

Unknown keys are dropped silently (extra="ignore"), like the old allow-list, so the frontend can
send whole objects. Fields the AI or a shop page fills in (hex, price) are cleaned up rather than
rejected, so one bad guess never blocks an upload.
"""
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Str = Annotated[str, Field(max_length=200)]
Note = Annotated[str, Field(max_length=1000)]
StrList = Annotated[list[Str], Field(max_length=20)]

Category = Literal["top", "bottom", "dress", "outerwear", "shoes", "bag", "accessory", "scent"]
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _loose_number(v):
    """'$49.99' -> 49.99, '' / junk -> None."""
    if v is None or isinstance(v, (int, float)):
        return v
    m = re.search(r"\d+(?:[.,]\d+)?", str(v))
    return float(m.group().replace(",", ".")) if m else None


class _Loose(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Measurements(_Loose):
    height_cm: str | float | None = None
    top_size: Str | None = None
    bottom_size: Str | None = None
    shoe_size: str | float | None = None
    fit: Str | None = None


class ProfilePatch(_Loose):
    name: Str | None = None
    age: Annotated[int, Field(ge=0, le=120)] | None = None
    gender: Str | None = None
    pronouns: Str | None = None
    tradition: Str | None = None
    modesty: Literal["none", "modest", "very modest", ""] | None = None
    dress_rules: StrList | None = None
    modesty_notes: Note | None = None
    styles: StrList | None = None
    colors_love: StrList | None = None
    colors_avoid: StrList | None = None
    measurements: Measurements | None = None
    budget: Annotated[float, Field(ge=0)] | None = None
    climate: Str | None = None
    ai_consent: bool | None = None
    theme: Str | None = None
    onboarded: bool | None = None
    accessories: StrList | None = None
    scents: StrList | None = None

    @model_validator(mode="after")
    def colours_not_in_both_lists(self):
        both = set(self.colors_love or []) & set(self.colors_avoid or [])
        if both:
            raise ValueError(f"A colour can't be both loved and avoided: {', '.join(sorted(both))}")
        return self


class ItemPatch(_Loose):
    name: Str | None = None
    category: Category | None = None
    rack: Str | None = None
    laundry: bool | None = None
    favorite: bool | None = None
    wear_count: Annotated[int, Field(ge=0)] | None = None
    color: Str | None = None
    hex: str | None = None
    material: Str | None = None
    brand: Str | None = None
    price: float | None = None
    styles: StrList | None = None
    seasons: StrList | None = None
    occasions: StrList | None = None
    status: Str | None = None
    starter: bool | None = None
    catalog_id: Str | None = None
    tier: Str | None = None
    source: Annotated[str, Field(max_length=2000)] | None = None
    care_label: Note | None = None
    fibers: Annotated[list[dict], Field(max_length=10)] | None = None
    notes: Note | None = None
    rotation: Annotated[int, Field(ge=-360, le=360)] | None = None  # how the photo is turned, in degrees

    @field_validator("hex", mode="before")
    @classmethod
    def clean_hex(cls, v):
        return v if isinstance(v, str) and HEX.match(v) else None

    @field_validator("price", mode="before")
    @classmethod
    def clean_price(cls, v):
        v = _loose_number(v)
        return v if v is None or v >= 0 else None


class ItemIn(ItemPatch):
    name: Str = "New item"
    category: Category = "top"


# ---------------------------------------------------------------- bag (shopping list)

BagSource = Literal["outfit", "critique", "chat", "window", "manual"]
Priority = Literal["low", "medium", "high"]
BagStatus = Literal["wanted", "bought", "dropped"]


class BagEntryPatch(_Loose):
    title: Str | None = None
    reason: Note | None = None
    priority: Priority | None = None
    status: BagStatus | None = None


class BagEntryIn(_Loose):
    catalog_id: Str | None = None  # set = a real catalog product; empty = just an idea ("black ankle boots")
    title: Str | None = None
    reason: Note = ""
    source: BagSource = "manual"
    source_ref: Str | None = None  # e.g. the critique gap or outfit it came from
    priority: Priority = "medium"
    status: BagStatus = "wanted"

    @model_validator(mode="after")
    def needs_something_to_want(self):
        if not self.catalog_id and not (self.title or "").strip():
            raise ValueError("Give the idea a title, or pick a catalog product")
        return self


# ---------------------------------------------------------------- saved boards and looks (FRONTEND_SPEC 8.2)

ClientId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")]
Pieces = Annotated[list[dict], Field(max_length=40)]
MAX_PIECES_JSON = 60_000  # characters; a board of 40 stickers is ~15k


def _check_pieces(pieces: list[dict] | None) -> None:
    import json

    if pieces and len(json.dumps(pieces)) > MAX_PIECES_JSON:
        raise ValueError("That board is too large to save")
    for p in pieces or []:
        img = (p.get("snap") or {}).get("image_url")
        if isinstance(img, str) and img.startswith("data:"):
            raise ValueError("Pieces must reference photos by link, not embed them")


class BoardIn(_Loose):
    id: ClientId | None = None
    name: Str = "Table"
    pieces: Pieces = Field(default_factory=list)
    savedAt: Str | None = None

    @model_validator(mode="after")
    def small_and_linked(self):
        _check_pieces(self.pieces)
        return self


class LookIn(BoardIn):
    name: Str = "Look"
    photo: Annotated[str, Field(max_length=2000)] | None = None
    tryon: Pieces | None = None
    verdict: Note = ""
    harmony: Str = ""
    occasion: Str | None = None
    favorite: bool = False

    @field_validator("photo")
    @classmethod
    def photo_is_a_link(cls, v):
        if v is None or v.startswith(("https://", "http://", "/uploads/")):
            return v
        raise ValueError("photo must be a link to an uploaded photo, not embedded image data")

    @model_validator(mode="after")
    def tryon_small_and_linked(self):
        _check_pieces(self.tryon)
        return self


class LookPatch(_Loose):
    favorite: bool | None = None
    name: Str | None = None
