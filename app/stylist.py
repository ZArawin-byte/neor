"""The stylist: Python scores every piece and assembles outfits; the model only chooses among them.

Deterministic on purpose - no randomness anywhere - so the reasons we print are the actual reasons and the
same closet always gives the same rules outfit. Colour maths is a port of frontend/src/lib/color.ts (OKLCH).
"""
import math

from .context import weather as wx_mod

# ------------------------------------------------------------------ colour (port of color.ts)


def _to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_rgb(hex_: str | None) -> tuple[float, float, float]:
    h = (hex_ or "#999999").replace("#", "").strip()
    if len(h) == 3:
        h = "".join(c + c for c in h)
    try:
        n = int(h[:6], 16)
    except ValueError:
        return (0.6, 0.6, 0.6)
    return (((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)


def lch(hex_: str) -> tuple[float, float, float]:
    r, g, b = (_to_linear(c) for c in hex_to_rgb(hex_))
    lc = math.copysign(abs(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3), 1)
    mc = math.copysign(abs(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3), 1)
    sc = math.copysign(abs(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3), 1)
    L = 0.2104542553 * lc + 0.793617785 * mc - 0.0040720468 * sc
    a = 1.9779984951 * lc - 2.428592205 * mc + 0.4505937099 * sc
    bb = 0.0259040371 * lc + 0.7827717662 * mc - 0.808675766 * sc
    return L, math.hypot(a, bb), (math.degrees(math.atan2(bb, a)) + 360) % 360


def hue_gap(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return 360 - d if d > 180 else d


def is_neutral(hex_: str) -> bool:
    L, C, h = lch(hex_)
    return (C < 0.045 or (C < 0.095 and 40 <= h <= 95) or (L < 0.45 and 230 <= h <= 280)
            or (C < 0.09 and 95 <= h <= 135 and L < 0.55))


def temperature(hex_: str) -> str:
    if is_neutral(hex_):
        return "neutral"
    h = lch(hex_)[2]
    return "warm" if h < 100 or h > 330 else "cool" if 140 < h < 300 else "neutral"


def hue_name(h: float) -> str:
    for top, name in ((15, "pink-red"), (40, "red"), (70, "orange"), (100, "yellow-gold"), (130, "yellow-green"),
                      (165, "green"), (200, "teal"), (240, "sky blue"), (275, "blue"), (310, "violet"),
                      (345, "magenta"), (360, "pink-red")):
        if h < top:
            return name
    return "red"


def color_family(hex_: str | None) -> str:
    return "neutral" if not hex_ or is_neutral(hex_) else hue_name(lch(hex_)[2])


def _jsround(x: float) -> int:
    return int(math.floor(x + 0.5))


def harmony_of(hexes: list[str]) -> dict:
    """Port of harmonyOf(): name, 0-100 score, plain reasons, temperature, contrast."""
    colours = [h for h in hexes if h]
    if not colours:
        return {"name": "Empty table", "score": 0, "lines": [], "temperature": "neutral", "contrast": "low"}
    chroma = [h for h in colours if not is_neutral(h)]
    Ls = [lch(h)[0] for h in colours]
    spread = max(Ls) - min(Ls)
    contrast = "high" if spread > 0.45 else "medium" if spread > 0.2 else "low"
    temps = {t for t in (temperature(h) for h in chroma) if t != "neutral"}
    temp = "neutral" if not temps else next(iter(temps)) if len(temps) == 1 else "mixed"
    lines: list[str] = []
    if not chroma:
        name, score = "Tonal neutrals", 68 if contrast == "low" else 84
        lines.append("Every piece is a neutral, so nothing fights for attention.")
    elif len(chroma) == 1:
        name, score = "Single accent", 90
        lines.append(f"One {hue_name(lch(chroma[0])[2])} piece carries all the colour; the neutrals frame it.")
    else:
        hs = [lch(h)[2] for h in chroma]
        gaps = [hue_gap(hs[i], hs[j]) for i in range(len(hs)) for j in range(i + 1, len(hs))]
        widest = max(gaps)
        if widest <= 40:
            name, score = "Analogous", 86
            lines.append(f"Your colours sit within {_jsround(widest)}° of each other on the wheel.")
        elif len(chroma) == 2 and widest >= 150:
            name, score = "Complementary", 82
            lines.append(f"The two colours are {_jsround(widest)}° apart, near-opposites; keep it about 70/30.")
        elif len(chroma) == 3 and all(95 <= g <= 145 for g in gaps):
            name, score = "Triadic", 74
            lines.append("Three colours spaced evenly round the wheel. Keep two of them small.")
        elif len(chroma) == 2 and widest >= 100:
            name, score = "Split contrast", 76
            lines.append(f"{_jsround(widest)}° apart: high energy without a straight clash.")
        else:
            name, score = "Competing colours", 52 - max(0, len(chroma) - 2) * 8
            lines.append(f"{len(chroma)} colours up to {_jsround(widest)}° apart pull the eye in different directions.")
    if temp == "mixed" and len(chroma) > 1:
        score -= 4
        lines.append("Mixing warm and cool colours; a neutral in between bridges them.")
    return {"name": name, "score": _jsround(min(100, max(0, score))), "lines": lines, "temperature": temp,
            "contrast": contrast}


# ------------------------------------------------------------------ slots

RACK_SLOT = {"shirts": "top", "tshirts": "top", "tanks": "top", "sweaters": "top", "pants": "bottom",
             "shorts": "bottom", "skirts": "bottom", "dresses": "onepiece", "jackets": "layer", "shoes": "shoes",
             "scarves": "extra", "bags": "extra", "accessories": "extra", "underthings": None}
OCCASIONS = ("everyday", "uni", "gym", "wedding", "birthday")


def rack_of(item: dict) -> str:
    from .ai import guess_rack  # one implementation of the racks.ts port

    return item.get("rack") if item.get("rack") in RACK_SLOT else guess_rack(item.get("name", ""), item.get("category", ""))


def slot_of(item: dict) -> str | None:
    if item.get("category") == "scent":
        return None
    return RACK_SLOT.get(rack_of(item))


# ------------------------------------------------------------------ scoring

def _words(xs) -> set[str]:
    return {str(x).strip().lower() for x in (xs or []) if str(x).strip()}


def score_item(item: dict, ctx: dict) -> tuple[float, list[str]]:
    """Score + the human reasons behind it. Every reason is one of the terms that was added."""
    score, why = 0.0, []
    occ = ctx["occasion"]
    if occ in (item.get("occasions") or []):
        score += 3
        why.append(f"tagged for {occ}")
    overlap = _words(item.get("styles")) & ctx["styles"]
    if overlap:
        score += min(2, len(overlap))
        why.append(f"{'/'.join(sorted(overlap))} like your style")
    seasons = _words(item.get("seasons"))
    if ctx["season"]:
        if ctx["season"] in seasons or "all" in seasons:
            score += 1
            why.append(f"right for {ctx['season']}")
        elif seasons:
            score -= 2
    rack, w = rack_of(item), ctx["weather"]
    if wx_mod.is_cold(w):
        if rack in ("jackets", "sweaters"):
            score += 2
            why.append(f"warm for {w['temp_c']}°C")
        elif rack in ("shorts", "tanks"):
            score -= 3
    if wx_mod.is_hot(w):
        if rack in ("sweaters", "jackets", "scarves"):
            score -= 3
        elif rack in ("shorts", "tanks"):
            score += 1
            why.append(f"cool for {w['temp_c']}°C")
    if wx_mod.is_wet(w) and rack == "shorts":
        score -= 2
    colour = f"{item.get('color', '')} {item.get('name', '')}".lower()
    if any(c in colour for c in ctx["love"]):
        score += 1.5
        why.append("a colour you love")
    if any(c in colour for c in ctx["avoid"]):
        score -= 3
    if item.get("favorite") or item.get("id") in ctx["liked"]:
        score += 1
        why.append("in your favourites")
    return score, why


def context(profile: dict, occasion: str, season: str = "", weather: dict | None = None,
            liked: set[str] | None = None) -> dict:
    return {"occasion": (occasion or "everyday").lower(), "season": (season or "").lower(), "weather": weather,
            "styles": _words(profile.get("styles")), "love": _words(profile.get("colors_love")),
            "avoid": _words(profile.get("colors_avoid")), "liked": liked or set()}


# ------------------------------------------------------------------ outfits

def templates(ctx: dict) -> list[list[str]]:
    layer = wx_mod.is_cold(ctx["weather"]) or wx_mod.is_wet(ctx["weather"]) or ctx["season"] in ("fall", "winter")
    base = [["top", "bottom", "shoes"], ["onepiece", "shoes"]]
    return [t + (["layer"] if layer else []) for t in base]


def candidates(closet: list[dict], ctx: dict, per_slot: int = 12) -> dict[str, list[dict]]:
    """Top pieces per slot, best first, ties broken by id. Each carries its score and reasons."""
    by_slot: dict[str, list[dict]] = {}
    for item in closet:
        slot = slot_of(item)
        if slot:
            s, why = score_item(item, ctx)
            by_slot.setdefault(slot, []).append({**item, "_score": s, "_why": why})
    return {k: sorted(v, key=lambda i: (-i["_score"], i["id"]))[:per_slot] for k, v in by_slot.items()}


def _total(pieces: list[dict]) -> tuple[float, dict]:
    harmony = harmony_of([p.get("hex") for p in pieces])
    return sum(p["_score"] for p in pieces) + harmony["score"] / 10, harmony


def build(closet: list[dict], ctx: dict, pieces: list[str] | None = None, top_n: int = 3, beam: int = 12) -> dict:
    """Beam search over the slot templates.

    Returns the per-slot shortlist, the top outfits, and empty_slots: the slots a purchase would fill
    (a required slot when nothing complete exists, or the layer the weather asks for but the closet lacks).
    """
    cands = candidates(closet, ctx)
    forced = [i for i in closet if i["id"] in set(pieces or [])]
    forced_slots = {slot_of(i) for i in forced}
    results, gaps_by_template = [], []
    for template in templates(ctx):
        if ("onepiece" in template and forced_slots & {"top", "bottom"}) or ("top" in template and "onepiece" in forced_slots):
            continue
        open_slots = [s for s in template if s not in forced_slots]
        absent = [s for s in open_slots if not cands.get(s)]
        gaps_by_template.append(absent)
        if [s for s in absent if s != "layer"]:
            continue  # a required slot is empty: no complete outfit from this template
        partial = [[{**i, "_score": score_item(i, ctx)[0], "_why": ["you picked it"]} for i in forced]]
        for slot in open_slots:
            if slot in absent:
                continue
            grown = [p + [c] for p in partial for c in cands[slot]]
            grown.sort(key=lambda p: (-_total(p)[0], tuple(sorted(i["id"] for i in p))))
            partial = grown[:beam]
        for p in partial:
            extras = [e for e in cands.get("extra", []) if e["id"] not in {i["id"] for i in p}]
            if extras:  # one accessory or bag, only when it keeps or raises the total
                best = sorted(extras, key=lambda e: (-_total(p + [e])[0], e["id"]))[0]
                if _total(p + [best])[0] >= _total(p)[0]:
                    p = p + [best]
            total, harmony = _total(p)
            results.append({"ids": [i["id"] for i in p], "score": round(total, 2), "harmony": harmony,
                            "reasons": _reasons(p, harmony), "absent": absent})
    seen, ranked = set(), []
    for r in sorted(results, key=lambda r: (-r["score"], tuple(sorted(r["ids"])))):
        key = tuple(sorted(r["ids"]))
        if key not in seen:
            seen.add(key)
            ranked.append(r)
    if ranked:
        empty = ranked[0].pop("absent")
        for r in ranked[1:]:
            r.pop("absent", None)
    else:
        empty = min(gaps_by_template, key=len) if gaps_by_template else []
    return {"candidates": cands, "outfits": ranked[:top_n], "empty_slots": empty, "complete": bool(ranked)}


def _reasons(pieces: list[dict], harmony: dict) -> str:
    bits = [f"{p.get('name', 'piece')} ({', '.join(p['_why'])})" for p in pieces if p["_why"]]
    text = "; ".join(bits[:4])
    return (f"{text}. " if text else "") + f"Colour: {harmony['name']} ({harmony['score']}/100)."


def count_complete(closet: list[dict], ctx: dict) -> int:
    """How many distinct complete outfits the closet can make from pieces tagged for this occasion (capped)."""
    tagged = [i for i in closet if ctx["occasion"] in (i.get("occasions") or [])]
    cands = candidates(tagged, ctx, per_slot=8)
    total = 0
    for template in templates(ctx):
        n = 1
        for slot in template:
            n *= len(cands.get(slot, []))
        total += n
    return min(total, 999)
