"""Hand-written fabric knowledge. Care advice comes from here first, so it is the same every time.

Ratings are 1 (low) to 5 (high). Sources: standard textile care practice (ISO 3758 care symbols,
fibre manufacturers' guidance). These are general rules, not claims about any brand.
"""
import re

FABRICS: dict[str, dict] = {
    "cotton": {"warmth": 2, "breathability": 5, "durability": 4, "wrinkling": 4,
               "care": ["Machine wash at 30-40°C with similar colours.", "Tumble dry low or line dry to limit shrinking.",
                        "Iron on medium-hot while slightly damp."]},
    "wool": {"warmth": 5, "breathability": 4, "durability": 4, "wrinkling": 1,
             "care": ["Hand wash cold or use the wool cycle with wool detergent.", "Never tumble dry: it felts and shrinks.",
                      "Dry flat on a towel, reshaping while damp.", "Air it between wears instead of washing.",
                      "Store folded with cedar against moths."]},
    "merino": {"warmth": 4, "breathability": 5, "durability": 3, "wrinkling": 1,
               "care": ["Wool cycle at 30°C, inside out.", "Dry flat; never tumble dry.",
                        "Air between wears - merino resists odour.", "Store folded with cedar against moths."]},
    "cashmere": {"warmth": 5, "breathability": 4, "durability": 2, "wrinkling": 1,
                 "care": ["Hand wash cold with a gentle wool shampoo, or dry clean.", "Press water out in a towel; never wring.",
                          "Dry flat away from heat.", "De-pill with a cashmere comb.", "Store folded with cedar."]},
    "linen": {"warmth": 1, "breathability": 5, "durability": 4, "wrinkling": 5,
              "care": ["Machine wash at 30-40°C on a gentle cycle.", "Line dry; take it in slightly damp.",
                       "Iron hot while damp, or embrace the creases."]},
    "silk": {"warmth": 2, "breathability": 4, "durability": 2, "wrinkling": 3,
             "care": ["Hand wash cold with a pH-neutral detergent, or dry clean.", "Never wring or tumble dry.",
                      "Dry flat or hang in the shade.", "Iron on the silk setting, inside out."]},
    "polyester": {"warmth": 2, "breathability": 1, "durability": 4, "wrinkling": 1,
                  "care": ["Machine wash at 30°C; it sheds microfibres, so a wash bag helps.", "Tumble dry low.",
                           "Iron cool if at all - high heat melts it."]},
    "nylon": {"warmth": 2, "breathability": 1, "durability": 5, "wrinkling": 1,
              "care": ["Machine wash cold.", "Line dry or tumble dry low.", "Keep irons and radiators away - it melts."]},
    "viscose": {"warmth": 2, "breathability": 4, "durability": 2, "wrinkling": 4,
                "care": ["Hand wash cold or gentle cycle at 30°C - it is weak when wet.", "Do not wring; dry flat or hang.",
                         "Iron on low, inside out."]},
    "elastane": {"warmth": 1, "breathability": 2, "durability": 2, "wrinkling": 1,
                 "care": ["Wash at 30°C or below to keep the stretch.", "Avoid tumble drying and high heat.",
                          "Skip fabric softener - it breaks down elastic fibres."]},
    "denim": {"warmth": 3, "breathability": 3, "durability": 5, "wrinkling": 2,
              "care": ["Wash rarely, inside out, cold, to keep the colour.", "Line dry to avoid shrinking.",
                       "Wash dark denim alone the first few times."]},
    "leather": {"warmth": 3, "breathability": 2, "durability": 5, "wrinkling": 1,
                "care": ["Never machine wash.", "Wipe with a damp cloth; condition every few months.",
                         "Dry naturally away from heat.", "Hang on a wide hanger with room to breathe."]},
    "suede": {"warmth": 3, "breathability": 2, "durability": 3, "wrinkling": 1,
              "care": ["Never machine wash.", "Brush with a suede brush to lift the nap.",
                       "Use a protector spray before wet weather.", "Take stains to a leather specialist."]},
    "down": {"warmth": 5, "breathability": 3, "durability": 4, "wrinkling": 1,
             "care": ["Wash rarely, on a gentle cycle with down wash.",
                      "Tumble dry low with dryer balls until fully dry, so the clusters don't clump.",
                      "Store loosely, not compressed."]},
}

ALIASES = {
    "spandex": "elastane", "lycra": "elastane", "rayon": "viscose", "modal": "viscose", "lyocell": "viscose",
    "tencel": "viscose", "polyamide": "nylon", "lambskin": "leather", "cowhide": "leather", "jean": "denim",
    "flax": "linen", "fleece": "polyester", "acrylic": "polyester", "feather": "down",
}

_WORD = re.compile(r"[a-z]+")


def fibers_in(text: str) -> list[str]:
    """Known fibres mentioned in a material description, in order of first mention."""
    found = []
    for word in _WORD.findall((text or "").lower()):
        fibre = ALIASES.get(word, word if word in FABRICS else None)
        if fibre is None and word.endswith("s"):
            fibre = ALIASES.get(word[:-1], word[:-1] if word[:-1] in FABRICS else None)
        if fibre and fibre not in found:
            found.append(fibre)
    return found


def care_steps(fibers: list[str]) -> list[str]:
    """Merged care steps; the most delicate fibre's rules come first because they win."""
    known = [f for f in fibers if f in FABRICS]
    known.sort(key=lambda f: FABRICS[f]["durability"])
    steps: list[str] = []
    for f in known:
        for s in FABRICS[f]["care"]:
            if s not in steps:
                steps.append(s)
    return steps[:6]


def profile(fibers: list[str]) -> dict | None:
    """Average ratings across the known fibres, e.g. for a 'material_explainer'."""
    known = [f for f in fibers if f in FABRICS]
    if not known:
        return None
    keys = ("warmth", "breathability", "durability", "wrinkling")
    return {k: round(sum(FABRICS[f][k] for f in known) / len(known), 1) for k in keys} | {"fibers": known}


def explain(fibers: list[str]) -> str:
    p = profile(fibers)
    if not p:
        return ""
    words = {1: "very low", 2: "low", 3: "medium", 4: "high", 5: "very high"}
    def w(k):
        return words[round(p[k])]
    return (f"{' and '.join(p['fibers']).capitalize()}: {w('warmth')} warmth, {w('breathability')} breathability, "
            f"{w('durability')} durability, {w('wrinkling')} wrinkling.")
