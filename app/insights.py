"""The lion's critique, computed from the closet. Every number here is a count, never a guess.

  * occasion coverage: can the stylist build a complete outfit for each occasion?
  * season coverage: can it build one from in-season pieces, for the seasons the user's climate has?
  * empty categories
  * neutrals vs accent colours
For each gap we suggest a catalog piece and count how many extra complete outfits it really unlocks.
"""
from . import stylist

DEFAULT_OCCASIONS = ("everyday", "uni", "gym", "wedding", "birthday")
CORE = ("top", "bottom", "shoes", "outerwear", "bag")
SLOT_FOR = {"top": "top", "bottom": "bottom", "shoes": "shoes", "outerwear": "layer", "dress": "onepiece",
            "bag": "extra", "accessory": "extra"}
SEASONS = ("spring", "summer", "fall", "winter")


def climate_seasons(climate: str | None) -> tuple[str, ...]:
    c = (climate or "").lower()
    if any(w in c for w in ("tropical", "desert", "hot all year", "equatorial")):
        return ("summer",)
    if any(w in c for w in ("cold", "snow", "arctic", "nordic")):
        return ("fall", "winter")
    return SEASONS


def _as_item(product: dict) -> dict:
    return {**product, "id": f"catalog:{product['id']}"}


def _in_season(item: dict, season: str) -> bool:
    s = {x.lower() for x in item.get("seasons") or []}
    return not s or season in s or "all" in s


def occasion_counts(closet: list[dict], profile: dict, occasions) -> dict[str, int]:
    return {o: stylist.count_complete(closet, stylist.context(profile, o)) for o in occasions}


def season_counts(closet: list[dict], profile: dict, seasons) -> dict[str, int]:
    out = {}
    for s in seasons:
        ctx = stylist.context(profile, "everyday", s)
        ctx["occasion"] = "__any__"
        pieces = [{**i, "occasions": ["__any__"]} for i in closet if _in_season(i, s)]
        out[s] = stylist.count_complete(pieces, ctx)
    return out


def _best_product(products: list[dict], profile: dict, category: str, occasion: str = "everyday",
                  season: str = "") -> dict | None:
    ctx = stylist.context(profile, occasion, season)
    options = [p for p in products if p["category"] == category]
    if not options:
        return None
    return sorted(options, key=lambda p: (-stylist.score_item(_as_item(p), ctx)[0], p["price"], p["id"]))[0]


def analyse(profile: dict, closet: list[dict], products: list[dict]) -> dict:
    """Facts for the critique: counts, gaps (with real unlocks) and a coverage-based score."""
    occasions = tuple(profile.get("occasions") or DEFAULT_OCCASIONS)
    seasons = climate_seasons(profile.get("climate"))
    occ = occasion_counts(closet, profile, occasions)
    sea = season_counts(closet, profile, seasons)
    cats = {c: sum(1 for i in closet if i.get("category") == c) for c in CORE + ("dress",)}
    hexes = [i.get("hex") for i in closet if i.get("hex")]
    neutrals = sum(1 for h in hexes if stylist.is_neutral(h))
    accents = len(hexes) - neutrals
    base_total = sum(occ.values()) + sum(sea.values())

    def unlocks(product: dict | None) -> int:
        """Extra complete outfits (per occasion + per climate season) the stylist can build with this piece."""
        if not product:
            return 0
        more = closet + [_as_item(product)]
        return (sum(occasion_counts(more, profile, occasions).values())
                + sum(season_counts(more, profile, seasons).values()) - base_total)

    candidates: list[dict] = []
    for o, n in occ.items():
        if n == 0:
            tagged = [i for i in closet if o in (i.get("occasions") or [])]
            have = {stylist.slot_of(i) for i in tagged}
            need = next((c for c, slot in (("top", "top"), ("bottom", "bottom"), ("shoes", "shoes"))
                         if slot not in have), "dress")
            p = _best_product(products, profile, need, o)
            candidates.append({"key": f"occasion-{o}", "gap": f"Nothing complete for {o}", "priority": "high",
                               "product": p, "evidence": f"0 complete {o} outfits; {len(tagged)} pieces tagged {o}",
                               "why": f"You can't build a full {o} outfit yet."})
    for c in CORE:
        if cats[c] == 0:
            p = _best_product(products, profile, c)
            candidates.append({"key": f"empty-{c}", "gap": f"No {c}", "priority": "high" if c != "bag" else "medium",
                               "product": p, "evidence": f"0 {c} items in the closet", "why": f"Your closet has no {c}."})
    for s, n in sea.items():
        if n == 0:
            need = "outerwear" if s in ("fall", "winter") else "top"
            p = _best_product(products, profile, need, "everyday", s)
            in_season = sum(1 for i in closet if _in_season(i, s))
            candidates.append({"key": f"season-{s}", "gap": f"Not ready for {s}", "priority": "medium", "product": p,
                               "evidence": f"0 complete outfits from in-season pieces; {in_season} pieces suit {s}",
                               "why": f"Your climate has a {s}, and nothing complete works in it."})
    if hexes and accents == 0:
        p = _best_product([x for x in products if not stylist.is_neutral(x["hex"])], profile, "top")
        candidates.append({"key": "colour-accent", "gap": "No accent colour", "priority": "low", "product": p,
                           "evidence": f"{neutrals} neutral pieces, 0 accent pieces",
                           "why": "Everything is neutral; one accent piece makes single-accent looks possible."})
    elif hexes and neutrals < 2:
        p = _best_product([x for x in products if stylist.is_neutral(x["hex"])], profile, "bottom")
        candidates.append({"key": "colour-neutrals", "gap": "Too few neutrals", "priority": "medium", "product": p,
                           "evidence": f"{neutrals} neutral pieces, {accents} accent pieces",
                           "why": "Accents need neutrals to sit next to."})

    seen, gaps = set(), []
    for g in candidates:
        if g["key"] in seen:
            continue
        seen.add(g["key"])
        p = g.pop("product")
        gaps.append({**g, "unlocks": unlocks(p), "catalog_ids": [p["id"]] if p else []})
    rank = {"high": 0, "medium": 1, "low": 2}
    gaps.sort(key=lambda g: (rank[g["priority"]], -g["unlocks"], g["key"]))

    occ_cov = sum(1 for n in occ.values() if n > 0) / len(occ)
    sea_cov = sum(1 for n in sea.values() if n > 0) / len(sea)
    balance = 1.0 if neutrals >= 2 and accents >= 1 else 0.5 if hexes else 0.0
    score = round(100 * (0.6 * occ_cov + 0.3 * sea_cov + 0.1 * balance))
    return {
        "score": score, "gaps": gaps[:5], "occasions": occ, "seasons": sea, "categories": cats,
        "neutrals": neutrals, "accents": accents, "pieces": len(closet),
        "score_basis": "60% occasions covered + 30% climate seasons covered + 10% neutral/accent balance",
    }
