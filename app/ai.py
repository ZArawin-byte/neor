"""Neor's brain. Groq-hosted Llama models, always in JSON mode.

Guardrails that matter for trust:
  * The model may only recommend products that exist in the catalog (ids are validated).
  * Every recommendation carries a human-readable "why".
  * If Groq is unavailable we fall back to transparent rule-based logic and say so.
"""
import base64
import json
import random

from . import config
from .seed import CATALOG, CATALOG_BY_ID

_client = None

PERSONA = (
    "You are Neor, a distinguished little lion tailor who lives in a magical wardrobe. "
    "You are warm, witty and brief, with a faint Narnian charm, but your advice is practical and honest. "
    "You never pressure people to buy; you prefer re-using what they own and only suggest purchases that fill a real gap. "
    "Always respect the user's modesty/cultural preferences, budget and style. "
    "Never invent products: only reference catalog ids you were given. Respond ONLY with valid JSON."
)


def client():
    global _client
    if _client is None:
        from groq import Groq

        _client = Groq(api_key=config.GROQ_API_KEY)
    return _client


def _chat_json(system: str, user: str | list, model: str | None = None, temperature: float = 0.6) -> dict:
    resp = client().chat.completions.create(
        model=model or config.GROQ_TEXT_MODEL,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format={"type": "json_object"},
        temperature=temperature,
        max_tokens=1200,
    )
    return json.loads(resp.choices[0].message.content)


def _closet_brief(closet: list[dict]) -> str:
    return json.dumps([
        {k: i.get(k) for k in ("id", "name", "category", "color", "material", "styles", "seasons", "occasions")}
        for i in closet
    ])


def _catalog_brief(products: list[dict] | None = None) -> str:
    return json.dumps([
        {k: p[k] for k in ("id", "name", "brand", "category", "color", "price", "material", "tier", "styles", "occasions", "seasons", "modest")}
        for p in (products or CATALOG)
    ])


def _profile_brief(profile: dict) -> str:
    keys = ("name", "styles", "modesty", "modesty_notes", "measurements", "budget", "scents", "colors_love", "colors_avoid", "climate")
    return json.dumps({k: profile.get(k) for k in keys if profile.get(k)})


def _valid_catalog_ids(ids) -> list[str]:
    return [i for i in (ids or []) if i in CATALOG_BY_ID]


def _eligible_catalog(profile: dict) -> list[dict]:
    if profile.get("modesty") in ("modest", "very modest"):
        return [p for p in CATALOG if p["modest"]]
    return CATALOG


# ------------------------------------------------------------------ 1. tag a photo

def tag_item(image: bytes, mime: str) -> dict:
    if not config.USE_GROQ:
        return {"name": "New item", "category": "top", "color": "unknown", "hex": "#b9a68a",
                "material": "unknown", "styles": [], "seasons": ["all"], "occasions": ["everyday"],
                "ai": "offline"}
    b64 = base64.b64encode(image).decode()
    prompt = [
        {"type": "text", "text": (
            "Identify the single main clothing item / accessory in this photo. Return JSON with keys: "
            "name (short, e.g. 'Cream Cable-Knit Sweater'), category (one of top,bottom,dress,outerwear,shoes,bag,accessory,scent), "
            "color (plain word), hex (best-guess hex), material (best guess, say 'likely' if unsure), "
            "styles (subset of classic,romantic,modern,street), seasons (subset of spring,summer,fall,winter,all), "
            "occasions (subset of everyday,gym,wedding,uni,birthday)."
        )},
        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
    ]
    try:
        out = _chat_json("You are a precise fashion cataloguer. Respond only with JSON.", prompt,
                         model=config.GROQ_VISION_MODEL, temperature=0.2)
        out["ai"] = "groq"
        return out
    except Exception as e:  # keep the upload flow alive even if vision fails
        return {"name": "New item", "category": "top", "color": "unknown", "hex": "#b9a68a",
                "styles": [], "seasons": ["all"], "occasions": ["everyday"], "ai": f"error: {e.__class__.__name__}"}


# ------------------------------------------------------------------ 2. outfit for an occasion / place

def outfit(profile: dict, closet: list[dict], occasion: str, place: str = "", season: str = "", travel: str = "") -> dict:
    closet_ids = {i["id"] for i in closet}
    if config.USE_GROQ:
        try:
            out = _chat_json(PERSONA, (
                f"USER PROFILE: {_profile_brief(profile)}\n"
                f"CLOSET: {_closet_brief(closet)}\n"
                f"CATALOG: {_catalog_brief(_eligible_catalog(profile))}\n\n"
                f"Build one outfit for occasion='{occasion}'"
                + (f", place/vibe='{place}'" if place else "")
                + (f", season='{season}'" if season else "")
                + (f", travelling to='{travel}' (consider local climate & cultural dress norms)" if travel else "")
                + ". Use closet items first. If a key piece is missing, suggest up to 2 catalog items.\n"
                "Return JSON: {\"title\": str, \"vibe\": str, \"closet_ids\": [ids], "
                "\"why\": str (2-3 sentences explaining color/fit/occasion logic), "
                "\"styling_tip\": str, \"scent\": str (a scent family suggestion), "
                "\"missing\": [{\"catalog_id\": id, \"why\": str}], "
                "\"cultural_note\": str (only if travel/modesty relevant, else empty)}"
            ))
            out["closet_ids"] = [i for i in out.get("closet_ids", []) if i in closet_ids]
            out["missing"] = [m for m in out.get("missing", []) if m.get("catalog_id") in CATALOG_BY_ID]
            out["ai"] = "groq"
            return out
        except Exception as e:
            fallback = _outfit_rules(profile, closet, occasion)
            fallback["ai"] = f"rules (AI error: {e.__class__.__name__})"
            return fallback
    return _outfit_rules(profile, closet, occasion)


def _outfit_rules(profile, closet, occasion) -> dict:
    picks, missing = [], []
    for cat in ("top", "bottom", "outerwear", "shoes"):
        matches = [i for i in closet if i.get("category") == cat and occasion in (i.get("occasions") or [])]
        if matches:
            picks.append(random.choice(matches)["id"])
        elif cat in ("top", "bottom", "shoes"):
            prod = next((p for p in _eligible_catalog(profile) if p["category"] == cat and occasion in p["occasions"]), None)
            if prod:
                missing.append({"catalog_id": prod["id"], "why": f"You have no {cat} tagged for {occasion}."})
    return {"title": f"{occasion.title()} look", "vibe": occasion, "closet_ids": picks,
            "why": "Picked pieces from your closet tagged for this occasion.",
            "styling_tip": "Tuck, cuff or layer to make it yours.", "scent": "", "missing": missing,
            "cultural_note": "", "ai": "rules"}


# ------------------------------------------------------------------ 3. weak spots / next-to-buy

def weak_spots(profile: dict, closet: list[dict]) -> dict:
    if config.USE_GROQ:
        try:
            out = _chat_json(PERSONA, (
                f"USER PROFILE: {_profile_brief(profile)}\nCLOSET: {_closet_brief(closet)}\n"
                f"CATALOG: {_catalog_brief(_eligible_catalog(profile))}\n\n"
                "Audit this closet like a tailor. Find weak spots: missing staple pieces, missing colors/neutrals, "
                "occasions the user cannot dress for, season gaps. Rank by how many new outfits each fix unlocks. "
                "Return JSON: {\"summary\": str, \"score\": int 0-100 (closet versatility), "
                "\"gaps\": [{\"gap\": str, \"why\": str, \"priority\": \"high\"|\"medium\"|\"low\", "
                "\"unlocks\": int (estimated new outfits), \"catalog_ids\": [1-2 ids]}]} (max 5 gaps)."
            ))
            for g in out.get("gaps", []):
                g["catalog_ids"] = _valid_catalog_ids(g.get("catalog_ids"))
            out["ai"] = "groq"
            return out
        except Exception:
            pass
    have = {i.get("category") for i in closet}
    gaps = []
    for cat, pid, why in (("outerwear", "p18", "No layering piece - a trench works with almost everything."),
                          ("shoes", "p09", "Clean white sneakers pair with 80% of casual outfits."),
                          ("bag", "p21", "A structured tote carries you from class to dinner."),
                          ("dress", "p05", "Nothing for weddings or formal birthdays yet.")):
        if cat not in have:
            gaps.append({"gap": f"No {cat}", "why": why, "priority": "high", "unlocks": 6, "catalog_ids": [pid]})
    gaps.append({"gap": "Elevated neutral top", "why": "A crisp oxford dresses up jeans and skirts alike.",
                 "priority": "medium", "unlocks": 5, "catalog_ids": ["p01"]})
    return {"summary": "A rule-based audit of your categories.", "score": max(20, 90 - 12 * len(gaps)),
            "gaps": gaps[:5], "ai": "rules"}


# ------------------------------------------------------------------ 4. conversational shopping

def shop_chat(profile: dict, closet: list[dict], history: list[dict], message: str, budget_left: float | None) -> dict:
    if config.USE_GROQ:
        try:
            convo = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in history[-8:])
            out = _chat_json(PERSONA, (
                f"USER PROFILE: {_profile_brief(profile)}\nCLOSET: {_closet_brief(closet)}\n"
                f"CATALOG: {_catalog_brief(_eligible_catalog(profile))}\n"
                f"BUDGET LEFT THIS MONTH: {budget_left if budget_left is not None else 'not set'}\n\n"
                f"CONVERSATION SO FAR:\n{convo}\nUSER: {message}\n\n"
                "Help them shop. Recommend 0-3 catalog products max. For each, explain why it fits THEM, "
                "which closet items it pairs with, and be honest about quality tier (S best ... D poor). "
                "If something is over budget or low quality, say so and offer an alternative. "
                "If they already own something similar, tell them to skip buying. "
                "Return JSON: {\"reply\": str (conversational, <= 80 words), "
                "\"picks\": [{\"catalog_id\": id, \"why\": str, \"pairs_with\": [closet ids]}]}"
            ), temperature=0.7)
            closet_ids = {i["id"] for i in closet}
            picks = []
            for p in out.get("picks", []):
                if p.get("catalog_id") in CATALOG_BY_ID:
                    p["pairs_with"] = [c for c in p.get("pairs_with", []) if c in closet_ids]
                    picks.append(p)
            return {"reply": out.get("reply", ""), "picks": picks, "ai": "groq"}
        except Exception as e:
            return {"reply": f"My mane's in a tangle (AI error: {e.__class__.__name__}). Try again in a moment?",
                    "picks": [], "ai": "error"}
    words = message.lower()
    hits = [p for p in _eligible_catalog(profile)
            if any(w in (p["name"] + " " + p["category"] + " " + " ".join(p["occasions"])).lower() for w in words.split() if len(w) > 2)]
    return {"reply": "Offline mode: here's what matched your words in the catalog. Add a GROQ_API_KEY for real advice!",
            "picks": [{"catalog_id": p["id"], "why": "Keyword match.", "pairs_with": []} for p in hits[:3]],
            "ai": "rules"}


# ------------------------------------------------------------------ 5. quality tier + care

def care(item: dict) -> dict:
    if config.USE_GROQ:
        try:
            return {**_chat_json(PERSONA, (
                f"ITEM: {json.dumps({k: item.get(k) for k in ('name', 'category', 'material', 'color', 'brand', 'price')})}\n\n"
                "Explain this garment's quality and care. Return JSON: {"
                "\"tier\": \"S\"|\"A\"|\"B\"|\"C\"|\"D\", \"tier_reason\": str, "
                "\"material_explainer\": str (what the fibers mean for feel, warmth, durability), "
                "\"care_steps\": [str] (wash temp, drying, ironing, storage - 4-6 steps), "
                "\"longevity\": str (expected lifespan with good care), "
                "\"cost_per_wear_tip\": str, \"sustainability\": str}"
            ), temperature=0.3), "ai": "groq"}
        except Exception:
            pass
    return {"tier": item.get("tier", "B"), "tier_reason": "Estimated from material only (offline).",
            "material_explainer": item.get("material", "Unknown material."),
            "care_steps": ["Check the care label first.", "Wash cold, inside out.", "Air dry flat when possible.",
                           "Store folded (knits) or on a wide hanger (tailoring)."],
            "longevity": "Several years with gentle care.", "cost_per_wear_tip": "Wear it 30+ times to make it worth it.",
            "sustainability": "Washing less and colder is the biggest eco win.", "ai": "rules"}


# ------------------------------------------------------------------ 6. places (real OSM data, AI picks)

def places(city: str, vibe: str, candidates: list[dict], profile: dict) -> dict:
    if config.USE_GROQ and candidates:
        try:
            out = _chat_json(PERSONA, (
                f"CITY: {city}\nVIBE WANTED: {vibe}\nUSER PROFILE: {_profile_brief(profile)}\n"
                f"REAL NEARBY PLACES (from OpenStreetMap): {json.dumps(candidates[:40])}\n\n"
                "Pick the 4 best spots for this vibe (cafes, photo spots, viewpoints, parks...). Only use ids given. "
                "Return JSON: {\"intro\": str, \"picks\": [{\"id\": id, \"why\": str, \"outfit_tip\": str, "
                "\"photo_tip\": str}]}"
            ))
            ids = {c["id"] for c in candidates}
            out["picks"] = [p for p in out.get("picks", []) if p.get("id") in ids]
            out["ai"] = "groq"
            return out
        except Exception:
            pass
    return {"intro": f"A few spots around {city}.",
            "picks": [{"id": c["id"], "why": f"A {c['kind']} nearby.", "outfit_tip": "", "photo_tip": ""} for c in candidates[:4]],
            "ai": "rules"}
