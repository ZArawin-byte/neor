"""neor's brain: Groq-hosted models, always through a strict json_schema. Owner: AI lane.

Trust guardrails (see CLAUDE.md):
  * Every model reply is validated with Pydantic; one retry with the error, then rules.
  * The model may only reference ids it was given; anything else is dropped.
  * Laundry items never reach a prompt or a rules path.
  * The profile brief never carries name, age, gender, pronouns or tradition.
  * Logs carry feature, model, engine, latency and error type only - never prompts or closet data.
"""
import json
import logging
import re
import time

from pydantic import BaseModel, ValidationError

from . import config
from .ai_schemas import (
    RACK_IDS, CareDraft, CareResult, OutfitDraft, OutfitResult, PlacesDraft, PlacesResult, ShopDraft, ShopResult,
    TagDraft, TagResult, WeakDraft, WeakSpots, strict_schema,
)
from . import insights, stylist
from .context import care_kb, weather
from .seed import CATALOG

log = logging.getLogger("neor.ai")

TEXT_CAP = 200
VISION_MAX_TOKENS = 400  # the free tier allows 1000 output tokens/minute on the vision model
HISTORY_TURNS = 8

PERSONA = (
    "You are neor, a distinguished little lion tailor who lives in a magical wardrobe. "
    "You are warm, witty and brief, but your advice is practical and honest. "
    "You never pressure people to buy; re-use what they own first and only suggest purchases that fill a real gap. "
    "Treat modesty, dress_rules and budget_band as hard constraints. "
    "Only reference ids you were given. Never invent products, prices, statistics, reviews or sustainability claims."
)

FIT_WORDS = ("fit", "size", "sizing", "length", "petite", "tall", "measure", "inseam", "loose", "tight")

_client = None


class AIFailure(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def client():
    global _client
    if _client is None:
        from groq import Groq

        _client = Groq(api_key=config.GROQ_API_KEY, timeout=config.AI_TIMEOUT_SECONDS, max_retries=1)
    return _client


# ------------------------------------------------------------------ plumbing

def cap(text: str | None, n: int = TEXT_CAP) -> str:
    return (text or "").strip()[:n]


def usable(items: list[dict]) -> list[dict]:
    """Laundry stays in the closet but never reaches the AI or the rules."""
    return [i for i in items if not i.get("laundry")]


def gate(profile: dict) -> str | None:
    """Why we can't use the model right now, or None if we can."""
    if profile.get("ai_consent") is False:
        return "consent_off"
    if not config.USE_GROQ:
        return "no_key"
    return None


def _log(feature: str, model: str, engine: str, t0: float, error: str | None = None) -> None:
    log.info("ai feature=%s model=%s engine=%s latency_ms=%d error=%s",
             feature, model, engine, (time.perf_counter() - t0) * 1000, error or "-")


def _extra(model: str) -> dict:
    # gpt-oss models reason before answering; keep it short so we stay fast.
    return {"extra_body": {"reasoning_effort": "low"}} if model.startswith("openai/gpt-oss") else {}


def _j(obj) -> str:
    """Compact JSON for prompts: the free tier is 8k tokens/minute on the big model."""
    return json.dumps(obj, separators=(",", ":"))


def _chat_json(feature: str, system: str, user: str | list, schema: type[BaseModel], model: str | None = None,
               temperature: float = 0.5, strict: bool = True, max_tokens: int = 2000) -> BaseModel:
    """One validated structured call. Retries once with the validation error, else raises AIFailure.

    strict=False is for the vision model, which loops in strict mode on image prompts; the reply is still
    validated with Pydantic either way.
    """
    model = model or config.GROQ_TEXT_MODEL
    response_format = {"type": "json_schema", "json_schema": {
        "name": schema.__name__, "strict": strict, "schema": strict_schema(schema)}}
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    t0 = time.perf_counter()
    swapped = False
    attempt = 0
    while attempt < 2:
        try:
            resp = client().chat.completions.create(
                model=model, messages=messages, response_format=response_format,
                temperature=temperature, max_tokens=max_tokens, **_extra(model))
        except Exception as e:
            # Rate-limited on the big model: try the fast one once before giving up.
            if type(e).__name__ == "RateLimitError" and not swapped and model == config.GROQ_TEXT_MODEL:
                swapped, model = True, config.GROQ_FAST_MODEL
                continue
            # Groq rejected its own generation against the schema: that's invalid output, so it gets the retry.
            if "json_validate_failed" in str(e) and attempt == 0:
                attempt = 1
                messages = messages + [{"role": "user", "content": "Your last reply broke the JSON schema. "
                                        "Reply again with short, valid JSON only."}]
                continue
            if "json_validate_failed" in str(e):
                _log(feature, model, "rules", t0, "ValidationError")
                raise AIFailure("invalid_output") from None
            _log(feature, model, "rules", t0, type(e).__name__)
            raise AIFailure("provider_error") from None
        attempt += 1
        content = resp.choices[0].message.content or ""
        try:
            out = schema.model_validate_json(content)
            _log(feature, model, "groq", t0, None if attempt == 1 else "retried")
            return out
        except ValidationError as e:
            problems = "; ".join(f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors()[:5])
            messages = messages + [
                {"role": "assistant", "content": content[:4000]},
                {"role": "user", "content": f"That JSON did not validate ({problems}). Reply with corrected JSON only."},
            ]
    _log(feature, model, "rules", t0, "ValidationError")
    raise AIFailure("invalid_output")


def _budget_band(budget) -> str | None:
    try:
        b = float(budget)
    except (TypeError, ValueError):
        return None
    if b <= 0:
        return None
    return "under $100/month" if b < 100 else "$100-300/month" if b <= 300 else "over $300/month"


def profile_brief(profile: dict, fit: bool = False) -> dict:
    """Only what styling needs. Never name, age, gender, pronouns or tradition."""
    keys = ("styles", "colors_love", "colors_avoid", "modesty", "dress_rules", "modesty_notes", "climate")
    out = {k: profile[k] for k in keys if profile.get(k)}
    band = _budget_band(profile.get("budget"))
    if band:
        out["budget_band"] = band
    if fit and profile.get("ai_consent") is True and profile.get("measurements"):
        out["measurements"] = profile["measurements"]
    return out


def closet_brief(items: list[dict]) -> list[dict]:
    keys = ("id", "name", "category", "rack", "color", "material", "styles", "seasons", "occasions")
    return [{k: i.get(k) for k in keys if i.get(k)} for i in usable(items)]


def catalog_brief(products: list[dict]) -> list[dict]:
    keys = ("id", "name", "brand", "category", "color", "price", "material", "tier", "styles", "occasions", "seasons")
    return [{k: p[k] for k in keys} for p in products]


def eligible_catalog(profile: dict, max_price: float | None = None) -> list[dict]:
    prods = CATALOG
    if profile.get("modesty") in ("modest", "very modest"):
        prods = [p for p in prods if p["modest"]]
    if max_price is not None:
        prods = [p for p in prods if p["price"] <= max_price]
    return prods


CATEGORY_WORDS = {
    "top": ("shirt", "tee", "top", "blouse", "sweater", "knit", "hoodie", "cardigan", "jumper"),
    "bottom": ("pant", "jean", "trouser", "skirt", "legging", "short", "chino", "cargo"),
    "dress": ("dress", "gown"),
    "outerwear": ("coat", "jacket", "blazer", "trench", "puffer", "parka", "warm", "rain", "layer"),
    "shoes": ("shoe", "sneaker", "boot", "trainer", "flat", "heel", "loafer"),
    "bag": ("bag", "tote", "purse", "crossbody"),
    "accessory": ("scarf", "hijab", "earring", "jewel", "necklace", "accessor"),
    "scent": ("perfume", "scent", "fragrance", "mist", "smell"),
}


def wanted_categories(text: str) -> set[str]:
    low = text.lower()
    return {cat for cat, words in CATEGORY_WORDS.items() if any(w in low for w in words)}


def shortlist_catalog(profile: dict, message: str, budget_left: float | None, n: int = 8) -> list[dict]:
    """Python narrows the catalog first (modesty, budget, words, style); the model only sees this list."""
    prods = eligible_catalog(profile, max_price=budget_left if budget_left and budget_left > 0 else None)
    cats = wanted_categories(message)
    words = {w for w in message.lower().split() if len(w) > 3}
    styles = set(profile.get("styles") or [])

    def score(p):
        text = f"{p['name']} {p['material']} {' '.join(p['occasions'])}".lower()
        return (3 * (p["category"] in cats) + sum(w in text for w in words) + len(styles & set(p["styles"])))

    return sorted(prods, key=lambda p: (-score(p), p["price"], p["id"]))[:n]


def owned_similar(products: list[dict], closet: list[dict]) -> dict[str, str]:
    """catalog id -> 'you already own X': same category and same colour family, decided in Python."""
    out = {}
    for p in products:
        fam = stylist.color_family(p.get("hex"))
        twin = next((i for i in sorted(closet, key=lambda i: i["id"]) if i.get("category") == p["category"]
                     and stylist.color_family(i.get("hex")) == fam), None)
        if twin:
            out[p["id"]] = f"You already own {twin.get('name', 'a similar piece')} ({p['category']}, {fam})."
    return out


def _dump(model: BaseModel) -> dict:
    return model.model_dump(exclude_none=True)


# ------------------------------------------------------------------ 1. tag a photo

def guess_rack(name: str, category: str) -> str:
    """Python port of guessRack() in frontend/src/lib/racks.ts."""
    words = {
        "shorts": ["short"], "underthings": ["sock", "underwear", "bra", "brief", "boxer", "tights"],
        "tanks": ["tank", "cami", "vest top", "singlet"], "tshirts": ["tee", "t-shirt", "tshirt", "crew"],
        "sweaters": ["sweater", "knit", "hoodie", "cardigan", "jumper", "sweatshirt", "pullover"],
        "jackets": ["jacket", "coat", "blazer", "trench", "puffer", "parka"],
        "dresses": ["dress", "gown", "jumpsuit"], "skirts": ["skirt"],
        "shirts": ["shirt", "blouse", "oxford", "button"],
        "pants": ["pant", "jean", "trouser", "legging", "chino", "cargo"],
        "shoes": ["shoe", "sneaker", "boot", "flat", "heel", "trainer", "loafer", "sandal"],
        "scarves": ["scarf", "hijab", "shawl"], "bags": ["bag", "tote", "purse", "crossbody", "backpack"],
        "accessories": ["earring", "necklace", "ring", "belt", "hat", "cap", "watch", "bracelet", "sunglass"],
    }
    low = (name or "").lower()
    for rack, ws in words.items():
        if any(w in low for w in ws):
            return rack
    return {"top": "tshirts", "bottom": "pants", "dress": "dresses", "outerwear": "jackets", "shoes": "shoes",
            "bag": "bags"}.get(category, "accessories")


def _hedge(material: str) -> str:
    m = (material or "").strip()
    if not m or m.lower() == "unknown":
        return "unknown - check the care label"
    return m if m.lower().startswith(("likely", "probably", "possibly")) else f"likely {m}"


def tag_item(image: bytes, mime: str, profile: dict | None = None) -> dict:
    reason = gate(profile or {})
    if reason is None:
        import base64

        prompt = [
            {"type": "text", "text": (
                "Identify the single main clothing item or accessory in this photo for a closet app. "
                f"rack must be one of: {', '.join(RACK_IDS)}. occasions from: everyday, gym, wedding, uni, birthday. "
                "material is a best guess from the look of the fabric. confidence is 0-1 for the category/rack.")},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(image).decode()}"}},
        ]
        try:
            d = _chat_json("tag", "You are a precise fashion cataloguer.", prompt, TagDraft,
                           model=config.GROQ_VISION_MODEL, temperature=0.2, strict=False,
                           max_tokens=VISION_MAX_TOKENS)
            return _dump(TagResult(
                name=cap(d.name, 80), category=d.category, color=d.color, hex=d.hex if d.hex.startswith("#") else None,
                material=_hedge(d.material), styles=list(dict.fromkeys(d.styles)), seasons=list(dict.fromkeys(d.seasons)),
                occasions=[o for o in d.occasions if o in ("everyday", "gym", "wedding", "uni", "birthday")],
                rack=d.rack, confidence=round(max(0.0, min(1.0, d.confidence)), 2), ai="groq"))
        except AIFailure as e:
            reason = e.reason
    return _dump(TagResult(name="New item", category="top", color="", material=_hedge(""), seasons=["all"],
                           occasions=["everyday"], rack="tshirts", confidence=0.0, ai="rules",
                           fallback_reason=reason))


# ------------------------------------------------------------------ 2. outfit (Python scores, Groq chooses)

SLOT_CATEGORY = {"top": "top", "bottom": "bottom", "onepiece": "dress", "layer": "outerwear", "shoes": "shoes",
                 "extra": "accessory"}


def suggest_missing(profile: dict, ctx: dict, slots: list[str], budget_left: float | None = None,
                    why_prefix: str = "Nothing in your closet fills the {slot} slot") -> list[dict]:
    """The best eligible catalog piece (modesty + budget respected) for each slot, with the scored reason."""
    out = []
    prods = eligible_catalog(profile, max_price=budget_left if budget_left and budget_left > 0 else None)
    for slot in slots:
        options = [p for p in prods if p["category"] == SLOT_CATEGORY.get(slot)]
        if not options:
            continue
        scored = sorted(((stylist.score_item({**p, "id": p["id"]}, ctx), p) for p in options),
                        key=lambda sp: (-sp[0][0], sp[1]["price"], sp[1]["id"]))
        (score, why), best = scored[0]
        reason = why_prefix.format(slot=slot, occasion=ctx["occasion"])
        out.append({"catalog_id": best["id"], "why": f"{reason}; {best['name']} is {', '.join(why) or 'a solid basic'}."})
    return out


def plan_outfit(profile: dict, closet: list[dict], occasion: str, season: str, wx: dict | None,
                pieces: list[str], liked: set[str], budget_left: float | None) -> tuple[dict, dict, list[dict]]:
    ctx = stylist.context(profile, occasion, season, wx, liked)
    for item in closet:  # learn from favourite looks: their styles count as the user's
        if item["id"] in liked:
            ctx["styles"] |= stylist._words(item.get("styles"))
    plan = stylist.build(closet, ctx, pieces)
    missing = suggest_missing(profile, ctx, plan["empty_slots"], budget_left)
    if plan["outfits"] and len(missing) < 2:
        best = {i["id"]: i for i in closet}
        untagged = [stylist.slot_of(best[i]) for i in plan["outfits"][0]["ids"]
                    if ctx["occasion"] not in (best[i].get("occasions") or []) and stylist.slot_of(best[i]) != "extra"]
        missing += suggest_missing(profile, ctx, untagged[: 2 - len(missing)], budget_left,
                                   "Nothing you own in the {slot} slot is tagged for {occasion}")
    return ctx, plan, missing[:2]


def outfit(profile: dict, closet: list[dict], occasion: str, place: str = "", season: str = "",
           travel: str = "", pieces: list[str] | None = None, liked: set[str] | None = None,
           budget_left: float | None = None) -> dict:
    closet = usable(closet)
    occasion, place, season, travel = cap(occasion) or "everyday", cap(place), cap(season), cap(travel)
    ids = {i["id"] for i in closet}
    pieces = [p for p in dict.fromkeys(pieces or []) if p in ids][:8]
    wx = weather.get_weather(travel or place) if (travel or place) else None
    ctx, plan, missing = plan_outfit(profile, closet, occasion, season, wx, pieces, liked or set(), budget_left)
    best = plan["outfits"][0] if plan["outfits"] else None
    reason = gate(profile)
    if reason is None and plan["candidates"]:
        # Aliases keep real ids out of the model's hands: it can only answer with i1..iN from this list.
        short = [c for slot in sorted(plan["candidates"]) for c in plan["candidates"][slot]]
        alias = {f"i{n}": c["id"] for n, c in enumerate(short, 1)}
        back = {v: k for k, v in alias.items()}
        listing = [{"ref": back[c["id"]], "slot": stylist.slot_of(c), "name": c.get("name"), "color": c.get("color"),
                    "material": c.get("material"), "score": c["_score"], "why": c["_why"]} for c in short]
        ready = [{"option": n, "refs": [back[i] for i in o["ids"]], "colour": f"{o['harmony']['name']} {o['harmony']['score']}",
                  "score": o["score"]} for n, o in enumerate(plan["outfits"], 1)]
        try:
            d = _chat_json("outfit", PERSONA, (
                f"PROFILE: {_j(profile_brief(profile))}\n"
                f"SHORTLIST (scored in Python; refs only): {_j(listing)}\n"
                f"READY OUTFITS (complete and colour-checked): {_j(ready)}\n"
                + (f"WEATHER (Open-Meteo, real): {weather.describe(wx)}\n" if wx else "")
                + (f"MUST INCLUDE refs (already worn): {_j([back[p] for p in pieces])}\n" if pieces else "")
                + (f"SUGGESTED PURCHASES (only these catalog ids may go in missing): {_j(missing)}\n" if missing else "")
                + f"\nOccasion '{occasion}'"
                + (f", place or vibe '{place}'" if place else "")
                + (f", season '{season}'" if season else "")
                + (f", travelling to '{travel}' (consider local dress norms)" if travel else "")
                + ". Pick one ready outfit, or refine it by swapping pieces from the shortlist. closet_ids are refs "
                "like i3. why is 2-3 sentences built on the given reasons, colour and weather. scent is a scent "
                "family. cultural_note is empty unless travel or modesty matters."), OutfitDraft)
            chosen = [alias[r] for r in d.closet_ids if r in alias]
            chosen = list(dict.fromkeys(pieces + chosen)) or (best["ids"] if best else [])
            allowed = {m["catalog_id"] for m in missing}
            return _dump(OutfitResult(
                title=d.title, vibe=d.vibe, closet_ids=chosen, why=d.why, styling_tip=d.styling_tip, scent=d.scent,
                cultural_note=d.cultural_note, ai="groq", weather=wx,
                missing=[m for m in missing if m["catalog_id"] in {x.catalog_id for x in d.missing} & allowed] or missing,
                harmony=stylist.harmony_of([i.get("hex") for i in closet if i["id"] in chosen])))
        except AIFailure as e:
            reason = e.reason
    why = best["reasons"] if best else "Your closet can't make a complete outfit for this yet."
    if wx:
        why += f" Weather: {weather.describe(wx)}."
    return _dump(OutfitResult(
        title=f"{occasion.title()} look", vibe=occasion, closet_ids=best["ids"] if best else [], why=why,
        styling_tip="Tuck, cuff or layer to make it yours.", missing=missing, ai="rules", weather=wx,
        fallback_reason=reason, harmony=best["harmony"] if best else None,
        alternatives=[o["ids"] for o in plan["outfits"][1:]]))


# ------------------------------------------------------------------ 3. weak spots (facts from insights.py)

_NUM = re.compile(r"\d+(?:\.\d+)?")


def _numbers_ok(text: str, facts_text: str) -> bool:
    """The model may reword, but every number it writes must already be in the facts."""
    allowed = set(_NUM.findall(facts_text))
    return all(n in allowed for n in _NUM.findall(text))


def weak_spots(profile: dict, closet: list[dict]) -> dict:
    closet = usable(closet)
    facts = insights.analyse(profile, closet, eligible_catalog(profile))
    gaps = facts["gaps"]
    occ_ok = sum(1 for n in facts["occasions"].values() if n > 0)
    summary = (f"{facts['pieces']} pieces cover {occ_ok} of {len(facts['occasions'])} occasions. "
               + (f"Biggest gap: {gaps[0]['gap'].lower()}." if gaps else "No gaps worth buying for."))
    extra = {"evidence": {k: facts[k] for k in ("occasions", "seasons", "categories", "neutrals", "accents",
                                                "pieces", "score_basis")}}
    reason = gate(profile)
    if reason is None and gaps:
        fact_text = _j({"summary": summary, **extra["evidence"], "gaps": gaps})
        try:
            d = _chat_json("weak_spots", PERSONA, (
                f"PROFILE: {_j(profile_brief(profile))}\n"
                f"FACTS (counted from the closet; do not change them): {fact_text}\n\n"
                "Write a short warm summary in the lion's voice, and for each gap key a one-sentence why. "
                "Only use numbers that appear in the facts."), WeakDraft, model=config.GROQ_FAST_MODEL)
            text = {g.key: g.why for g in d.gaps if _numbers_ok(g.why, fact_text)}
            gaps = [{**g, "why": text.get(g["key"], g["why"])} for g in gaps]
            summary = d.summary if _numbers_ok(d.summary, fact_text) else summary
            return _dump(WeakSpots(summary=summary, score=facts["score"], gaps=gaps, ai="groq", **extra))
        except AIFailure as e:
            reason = e.reason
    return _dump(WeakSpots(summary=summary, score=facts["score"], gaps=gaps, ai="rules", fallback_reason=reason,
                           **extra))


# ------------------------------------------------------------------ 4. shopping chat

def shop_chat(profile: dict, closet: list[dict], history: list[dict], message: str,
              budget_left: float | None) -> dict:
    closet = usable(closet)
    message = cap(message)
    history = [{"role": h.get("role", "user"), "content": cap(str(h.get("content", "")), 600)}
               for h in (history or [])[-HISTORY_TURNS:]]
    fit = any(w in message.lower() for w in FIT_WORDS)
    products = shortlist_catalog(profile, message, budget_left)
    similar = owned_similar(products, closet)
    reason = gate(profile)
    if reason is None:
        try:
            convo = "\n".join(f"{h['role'].upper()}: {h['content']}" for h in history)
            d = _chat_json("shop", PERSONA, (
                f"PROFILE: {_j(profile_brief(profile, fit=fit))}\n"
                f"CLOSET: {_j(closet_brief(closet))}\n"
                f"CATALOG (shortlisted in Python): {_j(catalog_brief(products))}\n"
                f"FACTS (computed, true): {_j(similar) if similar else 'the user owns nothing similar to these'}\n"
                f"BUDGET LEFT THIS MONTH: {budget_left if budget_left is not None else 'not set'}\n\n"
                f"CONVERSATION:\n{convo}\nUSER: {message}\n\n"
                "Reply in under 80 words. Recommend 0-3 catalog ids, each with why it fits and which closet ids it "
                "pairs with. Be honest about quality tier (S best, D poor). If they own something similar, say skip it."),
                ShopDraft, temperature=0.6)
            ids = {i["id"] for i in closet}
            allowed = {p["id"] for p in products}
            picks = [{"catalog_id": p.catalog_id, "why": p.why, "pairs_with": [c for c in p.pairs_with if c in ids]}
                     for p in d.picks if p.catalog_id in allowed][:3]
            return _dump(ShopResult(reply=d.reply, picks=picks, ai="groq"))
        except AIFailure as e:
            reason = e.reason
    words = [w for w in message.lower().split() if len(w) > 2]
    products = [p for p in products if p["id"] not in similar]
    hits = [p for p in products
            if any(w in f"{p['name']} {p['category']} {' '.join(p['occasions'])}".lower() for w in words)]
    return _dump(ShopResult(
        reply="Here's what matched your words in the catalog.", ai="rules", fallback_reason=reason,
        picks=[{"catalog_id": p["id"], "why": "Matches the words you used.", "pairs_with": []} for p in hits[:3]]))


# ------------------------------------------------------------------ 5. quality tier + care

GENERIC_CARE = ["Check the care label first.", "Wash cold, inside out.", "Air dry flat when possible.",
                "Store knits folded and tailoring on a wide hanger."]


def care(item: dict, profile: dict | None = None, owned: bool = False) -> dict:
    """Facts first: the care label (if read), then the fabric knowledge base, then the model's wording."""
    fibers = [f["fiber"] for f in item.get("fibers") or [] if f.get("fiber")] or care_kb.fibers_in(item.get("material", ""))
    kb_steps = care_kb.care_steps(fibers)
    basis = "care label" if item.get("care_label") or item.get("fibers") else "material" if fibers else "none"
    facts = {k: item.get(k) for k in ("name", "category", "material", "color", "price", "tier") if item.get(k)}
    if item.get("care_label"):
        facts["care_label"] = cap(item["care_label"], 600)
    extra = {"tier_basis": "estimate from material", "care_basis": basis} if owned else {"care_basis": basis}
    reason = gate(profile or {})
    if reason is None:
        try:
            d = _chat_json("care", PERSONA, (
                f"ITEM: {_j(facts)}\n"
                f"FABRIC FACTS (knowledge base, authoritative): {_j(care_kb.profile(fibers))}\n"
                f"CARE STEPS (knowledge base, authoritative): {_j(kb_steps)}\n\n"
                "Explain this garment's quality and how to care for it. If care steps were given, keep their meaning "
                "and only reword them; never contradict the care label. sustainability: general care advice only, "
                "no claims about the brand."), CareDraft, model=config.GROQ_FAST_MODEL, temperature=0.3)
            out = d.model_dump()
            if kb_steps:
                out["care_steps"] = kb_steps  # deterministic steps win over the model's wording
            return _dump(CareResult(**out, ai="groq", **extra))
        except AIFailure as e:
            reason = e.reason
    return _dump(CareResult(
        tier=item.get("tier", "B"), tier_reason="Estimated from the material only.",
        material_explainer=care_kb.explain(fibers) or item.get("material") or "Unknown material.",
        care_steps=kb_steps or GENERIC_CARE,
        longevity="Several years with gentle care.", cost_per_wear_tip="Price divided by the times you wear it.",
        sustainability="Washing less often and colder makes clothes last longer.", ai="rules", fallback_reason=reason,
        **extra))


# ------------------------------------------------------------------ 6. places (real OSM candidates, AI picks)

def places(city: str, vibe: str, candidates: list[dict], profile: dict, center: list[float]) -> dict:
    city, vibe = cap(city), cap(vibe)
    by_id = {c["id"]: c for c in candidates}
    reason = gate(profile) if candidates else None
    if reason is None and candidates:
        try:
            d = _chat_json("places", PERSONA, (
                f"CITY: {city}\nVIBE: {vibe}\nPROFILE: {_j(profile_brief(profile))}\n"
                f"REAL PLACES (OpenStreetMap): {_j([{k: c[k] for k in ('id', 'name', 'kind')} for c in candidates[:40]])}\n\n"
                "Pick the 4 best spots for this vibe. Only use ids given."), PlacesDraft, model=config.GROQ_FAST_MODEL,
                temperature=0)
            picks = [{**by_id[p.id], **p.model_dump()} for p in d.picks if p.id in by_id][:4]
            return _dump(PlacesResult(intro=d.intro, picks=picks, center=center, ai="groq"))
        except AIFailure as e:
            reason = e.reason
    picks = [{**c, "why": f"A {c['kind']} near {city}."} for c in candidates[:4]]
    return _dump(PlacesResult(intro=f"A few spots around {city}." if picks else f"No spots found around {city}.",
                              picks=picks, center=center, ai="rules", fallback_reason=reason))
