"""Call every AI feature once against real Groq with the starter closet; print engine and latency.

    .venv/bin/python -m scripts.ai_smoke
"""
import io
import logging
import sys
import time

from PIL import Image, ImageDraw

from app import ai, config
from app.seed import CATALOG_BY_ID, STARTER_CLOSET

CLOSET = [{**item, "id": f"s{n}"} for n, item in enumerate(STARTER_CLOSET, 1)]
PROFILE = {"styles": ["classic", "modern"], "colors_love": ["navy"], "budget": 200, "climate": "rainy, mild"}
PLACES = [
    {"id": "node/1", "name": "Cafe Allegro", "kind": "cafe", "lat": 47.6585, "lon": -122.3134},
    {"id": "way/2", "name": "Gas Works Park", "kind": "park", "lat": 47.6456, "lon": -122.3344},
    {"id": "node/3", "name": "Kerry Park", "kind": "viewpoint", "lat": 47.6295, "lon": -122.3599},
    {"id": "node/4", "name": "Henry Art Gallery", "kind": "gallery", "lat": 47.6566, "lon": -122.3115},
    {"id": "node/5", "name": "Volunteer Park Conservatory", "kind": "attraction", "lat": 47.6326, "lon": -122.3153},
]


def sweater_photo() -> bytes:
    img = Image.new("RGB", (512, 512), (245, 245, 240))
    d = ImageDraw.Draw(img)
    d.polygon([(150, 120), (220, 90), (292, 90), (362, 120), (440, 230), (395, 260), (360, 220), (360, 440),
               (152, 440), (152, 220), (117, 260), (72, 230)], fill=(30, 45, 90))
    out = io.BytesIO()
    img.save(out, "JPEG")
    return out.getvalue()


FEATURES = {
    "tag": lambda: ai.tag_item(sweater_photo(), "image/jpeg", PROFILE),
    "outfit": lambda: ai.outfit(PROFILE, CLOSET, "uni", place="Suzzallo Library", season="fall"),
    "weak_spots": lambda: ai.weak_spots(PROFILE, CLOSET),
    "shop": lambda: ai.shop_chat(PROFILE, CLOSET, [], "I need something warm for rainy walks to class", 150),
    "care": lambda: ai.care(CATALOG_BY_ID["p02"], PROFILE),
    "places": lambda: ai.places("Seattle", "cozy cafe and photo spots", PLACES, PROFILE, [47.62, -122.33]),
}


def main() -> int:
    logging.basicConfig(level=logging.WARNING)
    if not config.USE_GROQ:
        print("GROQ_API_KEY is not set in .env - every feature will report rules/no_key.")
    failures = 0
    for name, run in FEATURES.items():
        t0 = time.perf_counter()
        out = run()
        ms = (time.perf_counter() - t0) * 1000
        extra = f"  ({out.get('fallback_reason')})" if out.get("fallback_reason") else ""
        print(f"{name:<11} engine={out['ai']:<6} latency={ms:7.0f} ms{extra}")
        failures += out["ai"] != "groq"
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
