"""Pydantic models for every AI output. Owner: AI lane.

Two kinds of model live here:
  * *Result models are the API response shapes. They mirror frontend/src/lib/types.ts exactly;
    extra fields are additive only (fallback_reason, weather, evidence...).
  * *Draft models are what the LLM is allowed to write. They are sent to Groq as a strict
    json_schema, validated with model_validate, then merged with facts computed in Python.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict

FallbackReason = Literal["no_key", "provider_error", "invalid_output", "consent_off"]
Category = Literal["top", "bottom", "dress", "outerwear", "shoes", "bag", "accessory", "scent"]
Style = Literal["classic", "romantic", "modern", "street"]
Season = Literal["spring", "summer", "fall", "winter", "all"]
Tier = Literal["S", "A", "B", "C", "D"]
# The 14 racks in frontend/src/lib/racks.ts
RackId = Literal[
    "shirts", "tshirts", "tanks", "sweaters", "jackets", "pants", "shorts", "skirts", "dresses",
    "shoes", "scarves", "bags", "accessories", "underthings",
]
RACK_IDS: tuple[str, ...] = RackId.__args__


# ------------------------------------------------------------------ API results (types.ts)

class _Out(BaseModel):
    model_config = ConfigDict(extra="allow")


class Weather(_Out):
    temp_c: float | None
    precip_prob: float | None
    wind_kmh: float | None
    condition: str
    source: str = "open-meteo"
    fetched_at: str
    place: str | None = None


class MissingItem(_Out):
    catalog_id: str
    why: str


class OutfitResult(_Out):
    title: str
    vibe: str
    closet_ids: list[str]
    why: str
    styling_tip: str
    scent: str = ""
    missing: list[MissingItem] = []
    cultural_note: str = ""
    ai: str
    fallback_reason: FallbackReason | None = None
    weather: Weather | None = None


class Gap(_Out):
    gap: str
    why: str
    priority: Literal["high", "medium", "low"]
    unlocks: int
    catalog_ids: list[str]
    key: str | None = None
    evidence: str | None = None


class WeakSpots(_Out):
    summary: str
    score: int
    gaps: list[Gap]
    ai: str
    fallback_reason: FallbackReason | None = None


class PlacePick(_Out):
    id: str
    name: str
    kind: str
    lat: float
    lon: float
    why: str = ""
    outfit_tip: str = ""
    photo_tip: str = ""


class PlacesResult(_Out):
    intro: str
    picks: list[PlacePick]
    center: list[float]
    ai: str
    fallback_reason: FallbackReason | None = None


class TagResult(_Out):
    name: str
    category: str
    color: str = ""
    hex: str | None = None
    material: str = ""
    styles: list[str] = []
    seasons: list[str] = []
    occasions: list[str] = []
    rack: str | None = None
    confidence: float | None = None
    ai: str
    fallback_reason: FallbackReason | None = None


class ShopPick(_Out):
    catalog_id: str
    why: str
    pairs_with: list[str] = []


class ShopResult(_Out):
    reply: str
    picks: list[ShopPick]
    ai: str
    fallback_reason: FallbackReason | None = None


class CareResult(_Out):
    tier: str
    tier_reason: str
    material_explainer: str
    care_steps: list[str]
    longevity: str
    cost_per_wear_tip: str
    sustainability: str
    ai: str
    fallback_reason: FallbackReason | None = None


class FiberPart(BaseModel):
    fiber: str
    percent: float | None


class CareSymbols(BaseModel):
    wash_temp_c: int | None
    machine_wash: bool | None
    bleach: bool | None
    tumble_dry: bool | None
    iron: bool | None
    dry_clean: bool | None


class CareLabelResult(_Out):
    text: str
    fiber_composition: list[FiberPart]
    care: CareSymbols
    care_steps: list[str]
    source: Literal["label"] = "label"
    ai: str


# ------------------------------------------------------------------ LLM drafts (strict json_schema)

class _Draft(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MissingDraft(_Draft):
    catalog_id: str
    why: str


class OutfitDraft(_Draft):
    title: str
    vibe: str
    closet_ids: list[str]
    why: str
    styling_tip: str
    scent: str
    cultural_note: str
    missing: list[MissingDraft]


class GapTextDraft(_Draft):
    key: str
    why: str


class WeakDraft(_Draft):
    summary: str
    gaps: list[GapTextDraft]


class ShopPickDraft(_Draft):
    catalog_id: str
    why: str
    pairs_with: list[str]


class ShopDraft(_Draft):
    reply: str
    picks: list[ShopPickDraft]


class CareDraft(_Draft):
    tier: Tier
    tier_reason: str
    material_explainer: str
    care_steps: list[str]
    longevity: str
    cost_per_wear_tip: str
    sustainability: str


class PlacePickDraft(_Draft):
    id: str
    why: str
    outfit_tip: str
    photo_tip: str


class PlacesDraft(_Draft):
    intro: str
    picks: list[PlacePickDraft]


class TagDraft(_Draft):
    name: str
    category: Category
    color: str
    hex: str
    material: str
    styles: list[Style]
    seasons: list[Season]
    occasions: list[str]
    rack: RackId
    confidence: float


class LabelDraft(_Draft):
    text: str
    fiber_composition: list[FiberPart]
    care: CareSymbols


def strict_schema(model: type[BaseModel]) -> dict:
    """Pydantic JSON schema -> Groq strict mode: every property required, objects closed, no titles/defaults."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def inline(node):
        # Groq's strict decoder is unreliable with $ref, so nested models are inlined.
        if isinstance(node, list):
            return [inline(n) for n in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            return inline(dict(defs[node["$ref"].rsplit("/", 1)[-1]]))
        return {k: inline(v) for k, v in node.items()}

    schema = inline(schema)

    def fix(node):
        if isinstance(node, list):
            for n in node:
                fix(n)
            return
        if not isinstance(node, dict):
            return
        node.pop("title", None)
        node.pop("default", None)
        if "properties" in node:
            node["required"] = list(node["properties"])
            node["additionalProperties"] = False
            for prop in node["properties"].values():
                fix(prop)
        for key in ("items", "anyOf", "$defs"):
            if key in node:
                fix(list(node[key].values()) if key == "$defs" else node[key])

    fix(schema)
    return schema
