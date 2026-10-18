"""Create (or reuse) the demo account and fill it with a fictional closet. Safe to run repeatedly.

    .venv/bin/python -m scripts.seed_demo          # seeds once; later runs leave it alone
    .venv/bin/python -m scripts.reset_demo         # wipe the demo account's data and seed again

With Supabase keys in .env it uses the DEMO_EMAIL account (password DEMO_PASSWORD), creating it if
needed. Without them it seeds the local demo-mode user. It never touches any other account.
"""
import datetime as dt
import os
import secrets
import sys

from app import config, store
from app.seed import STARTER_CLOSET

RACKS = {"Grey Crew Tee": "tshirts", "Black Skinny Jeans": "pants", "Navy Hoodie": "sweaters", "Pink Blouse": "shirts",
         "Denim Jacket": "jackets", "Canvas Sneakers": "shoes", "Black Midi Skirt": "skirts", "Gym Shorts": "shorts"}

PROFILE = {
    "name": "Demo", "styles": ["classic", "romantic"], "colors_love": ["navy", "cream"], "colors_avoid": ["orange"],
    "modesty": "none", "climate": "Seattle: mild, rainy autumns", "budget": 300, "ai_consent": True,
    "onboarded": True, "demo_seeded": True,
}


def demo_uid() -> str:
    if not config.USE_SUPABASE:
        return config.DEMO_USER_ID
    email, password = config.DEMO_EMAIL, os.getenv("DEMO_PASSWORD", "")
    if not email or not password:
        sys.exit("Set DEMO_EMAIL and DEMO_PASSWORD in .env first.")
    admin = store.sb().auth.admin
    for user in admin.list_users():
        if (user.email or "").lower() == email.lower():
            return user.id
    return admin.create_user({"email": email, "password": password, "email_confirm": True}).user.id


def _piece(item: dict, x: float, y: float, rot: float) -> dict:
    return {"key": f"{item['id']}-{x:.0f}", "source": "closet", "refId": item["id"], "x": x, "y": y, "rot": rot,
            "snap": {"name": item["name"], "hex": item.get("hex", "#999999"), "rack": item.get("rack", "tshirts"),
                     "image_url": None}}


def seed(uid: str) -> None:
    if store.get_profile(uid).get("demo_seeded"):
        print("Demo account is already seeded. Run scripts.reset_demo to start it over.")
        return
    store.save_profile(uid, PROFILE)
    items = {i["name"]: store.add_item(uid, {**i, "starter": True, "rack": RACKS.get(i["name"])}) for i in STARTER_CLOSET}

    store.add_bag_entry(uid, {"catalog_id": "p18", "title": "Trench Coat", "source": "critique", "priority": "high",
                              "reason": "You have no rain-ready layer, and Seattle autumns are wet.", "status": "wanted"})
    store.add_bag_entry(uid, {"catalog_id": None, "title": "Black waterproof ankle boots", "source": "critique",
                              "priority": "medium", "reason": "Your only shoes are canvas sneakers.", "status": "wanted"})

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    uni = [_piece(items["Pink Blouse"], 35, 30, -3), _piece(items["Black Midi Skirt"], 38, 68, 2),
           _piece(items["Canvas Sneakers"], 70, 78, 4), _piece(items["Denim Jacket"], 68, 32, -2)]
    weekend = [_piece(items["Grey Crew Tee"], 35, 30, 2), _piece(items["Black Skinny Jeans"], 38, 68, -2),
               _piece(items["Navy Hoodie"], 68, 30, 3), _piece(items["Canvas Sneakers"], 70, 78, -4)]
    store.add_board(uid, {"id": secrets.token_hex(8), "name": "Table no. 1", "pieces": uni, "savedAt": now})
    store.add_board(uid, {"id": secrets.token_hex(8), "name": "Lazy Sunday", "pieces": weekend, "savedAt": now})
    store.add_look(uid, {"id": secrets.token_hex(8), "name": "Lecture day", "pieces": uni, "photo": None, "verdict": "Soft blush, grounded by black.",
                         "harmony": "Single accent · 90", "occasion": "uni", "favorite": True, "savedAt": now})
    store.add_look(uid, {"id": secrets.token_hex(8), "name": "Lazy Sunday", "pieces": weekend, "photo": None, "verdict": "Tonal and easy.",
                         "harmony": "Tonal neutrals · 84", "occasion": "everyday", "favorite": False, "savedAt": now})
    print(f"Seeded the demo account: {len(items)} pieces, 2 bag entries, 2 boards, 2 looks.")


if __name__ == "__main__":
    seed(demo_uid())
