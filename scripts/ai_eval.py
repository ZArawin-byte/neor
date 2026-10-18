"""Ten fixed requests against real Groq on the starter closet. Writes the measured numbers to docs/ai_eval.md.

    .venv/bin/python -m scripts.ai_eval
"""
import datetime as dt
import statistics
import sys
import time

from pydantic import ValidationError

from app import ai, config
from app.ai_schemas import CareResult, OutfitResult, ShopResult, WeakSpots
from app.config import ROOT
from app.seed import CATALOG_BY_ID, STARTER_CLOSET

CLOSET = [{**item, "id": f"s{n}"} for n, item in enumerate(STARTER_CLOSET, 1)]
CLOSET_IDS = {i["id"] for i in CLOSET}
BASE = {"styles": ["classic", "modern"], "budget": 200, "climate": "rainy, mild"}
MODEST = {**BASE, "modesty": "modest", "dress_rules": ["arms covered", "loose fit"]}
PACE_SECONDS = 7  # the free tier is 8k tokens/minute on gpt-oss-120b

CASES = [
    ("University day", "outfit", lambda: ai.outfit(BASE, CLOSET, "uni", season="fall")),
    ("Modest wedding", "outfit", lambda: ai.outfit(MODEST, CLOSET, "wedding")),
    ("Seattle, live weather", "outfit", lambda: ai.outfit(BASE, CLOSET, "everyday", place="Seattle")),
    ("Gym session", "outfit", lambda: ai.outfit(BASE, CLOSET, "gym")),
    ("Cafe date", "outfit", lambda: ai.outfit(BASE, CLOSET, "birthday", place="Cafe Allegro, Seattle")),
    ("Travel to Dubai", "outfit", lambda: ai.outfit(MODEST, CLOSET, "everyday", travel="Dubai")),
    ("Winter birthday", "outfit", lambda: ai.outfit(BASE, CLOSET, "birthday", season="winter")),
    ("Shop: wedding shoes", "shop", lambda: ai.shop_chat(MODEST, CLOSET, [], "shoes for a wedding under $100", 100)),
    ("Lion critique", "weak_spots", lambda: ai.weak_spots(BASE, CLOSET)),
    ("Care: wool coat", "care", lambda: ai.care(CATALOG_BY_ID["p02"], BASE)),
]
MODELS = {"outfit": OutfitResult, "shop": ShopResult, "weak_spots": WeakSpots, "care": CareResult}


def invented(kind: str, out: dict) -> list[str]:
    """Every id the response mentions that we never gave the model."""
    bad = []
    if kind == "outfit":
        bad += [i for i in out.get("closet_ids", []) if i not in CLOSET_IDS]
        bad += [m["catalog_id"] for m in out.get("missing", []) if m["catalog_id"] not in CATALOG_BY_ID]
    elif kind == "shop":
        for p in out.get("picks", []):
            bad += [p["catalog_id"]] if p["catalog_id"] not in CATALOG_BY_ID else []
            bad += [c for c in p.get("pairs_with", []) if c not in CLOSET_IDS]
    elif kind == "weak_spots":
        bad += [c for g in out.get("gaps", []) for c in g["catalog_ids"] if c not in CATALOG_BY_ID]
    return bad


def pct(part: int, whole: int) -> str:
    return f"{100 * part / whole:.0f}% ({part}/{whole})"


def main() -> int:
    if not config.USE_GROQ:
        print("GROQ_API_KEY is not set; the eval measures Groq, so add it to .env first.")
        return 1
    rows, latencies, valid, fallbacks, ids_total, ids_bad = [], [], 0, 0, 0, 0
    for n, (name, kind, run) in enumerate(CASES):
        if n:
            time.sleep(PACE_SECONDS)
        t0 = time.perf_counter()
        out = run()
        ms = (time.perf_counter() - t0) * 1000
        latencies.append(ms)
        try:
            MODELS[kind].model_validate(out)
            ok = True
        except ValidationError:
            ok = False
        valid += ok
        fallbacks += out["ai"] != "groq"
        bad = invented(kind, out)
        ids_bad += len(bad)
        ids_total += (len(out.get("closet_ids", [])) + len(out.get("missing", [])) if kind == "outfit"
                      else sum(1 + len(p.get("pairs_with", [])) for p in out.get("picks", [])) if kind == "shop"
                      else sum(len(g["catalog_ids"]) for g in out.get("gaps", [])) if kind == "weak_spots" else 0)
        note = out.get("fallback_reason") or (out.get("weather") or {}).get("condition", "")
        rows.append((name, kind, out["ai"], ok, len(bad), ms, note))
        print(f"{name:<20} {kind:<10} engine={out['ai']:<6} valid={ok!s:<5} invented={len(bad)} {ms:7.0f} ms {note}")

    p50 = statistics.median(latencies)
    p95 = sorted(latencies)[max(0, round(0.95 * len(latencies)) - 1)]
    summary = {
        "Schema-valid rate": pct(valid, len(CASES)),
        "Invented-id rate": f"{100 * ids_bad / ids_total:.0f}% ({ids_bad}/{ids_total} ids)" if ids_total else "0% (0 ids)",
        "Fallback rate": pct(fallbacks, len(CASES)),
        "Latency p50": f"{p50:.0f} ms",
        "Latency p95": f"{p95:.0f} ms",
    }
    for k, v in summary.items():
        print(f"{k}: {v}")

    when = dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")
    lines = [
        "# neor AI eval",
        "",
        f"Measured {when} by `scripts/ai_eval.py`: 10 fixed requests on the 8-piece starter closet, against real Groq "
        f"(`{config.GROQ_TEXT_MODEL}` text, `{config.GROQ_FAST_MODEL}` fast, `{config.GROQ_VISION_MODEL}` vision), "
        f"free tier, {PACE_SECONDS}s between requests. These are the numbers from that run, not targets.",
        "",
        "| Metric | Result |",
        "|---|---|",
        *[f"| {k} | {v} |" for k, v in summary.items()],
        "",
        "- **Schema-valid**: the response parses into the Pydantic model that mirrors `frontend/src/lib/types.ts`.",
        "- **Invented id**: any closet or catalog id in the response that the model was never given. Must be 0.",
        "- **Fallback**: the answer came from the rule-based path instead of Groq (still valid, labelled `ai: rules`).",
        "- **Latency**: wall time per request, including real weather lookups where a place is named.",
        "",
        "| Request | Feature | Engine | Valid | Invented ids | Latency | Note |",
        "|---|---|---|---|---|---|---|",
        *[f"| {r[0]} | {r[1]} | {r[2]} | {'yes' if r[3] else 'no'} | {r[4]} | {r[5]:.0f} ms | {r[6]} |" for r in rows],
        "",
    ]
    (ROOT / "docs" / "ai_eval.md").write_text("\n".join(lines))
    print("wrote docs/ai_eval.md")
    return 0 if ids_bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
