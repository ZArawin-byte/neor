"""Core lane: validation, ownership, uploads."""
import io
import json

from PIL import Image

from app import config
from tests.conftest import make_image


def _add(client, **meta):
    return client.post("/api/items", data={"meta": json.dumps({"name": "Tee", "category": "top", **meta})})


# ------------------------------------------------------------------ validation

def test_bad_meta_json_is_422(client):
    assert client.post("/api/items", data={"meta": "{not json"}).status_code == 422


def test_bad_category_is_422_but_bad_hex_and_price_are_cleaned(client):
    assert _add(client, category="spaceship").status_code == 422
    item = _add(client, hex="beige-ish", price="$49.99", ai="groq", rack="sweaters").json()
    assert "hex" not in item and item["price"] == 49.99 and item["rack"] == "sweaters" and "ai" not in item


def test_profile_rejects_colour_in_both_lists_and_drops_unknown_keys(client):
    assert client.put("/api/profile", json={"colors_love": ["red"], "colors_avoid": ["red"]}).status_code == 422
    body = client.put("/api/profile", json={"name": "Ada", "is_admin": True,
                                            "measurements": {"height_cm": "170", "fit": "relaxed"}}).json()
    assert body["name"] == "Ada" and "is_admin" not in body and body["measurements"]["fit"] == "relaxed"


def test_profile_patch_keeps_untouched_fields(client):
    client.put("/api/profile", json={"name": "Ada", "budget": 200})
    assert client.put("/api/profile", json={"budget": 150}).json()["name"] == "Ada"


def test_long_strings_are_rejected(client):
    assert _add(client, name="x" * 500).status_code == 422


# ------------------------------------------------------------------ ownership

def test_other_users_item_is_404(client, as_user):
    as_user("alice")
    item = _add(client).json()
    as_user("bob")
    assert client.patch(f"/api/items/{item['id']}", json={"name": "mine now"}).status_code == 404
    assert client.delete(f"/api/items/{item['id']}").status_code == 404
    assert client.post(f"/api/items/{item['id']}/worn").status_code == 404
    as_user("alice")
    assert client.get("/api/items").json()[0]["name"] == "Tee"


def test_missing_item_is_404(client):
    assert client.patch("/api/items/nope", json={"name": "x"}).status_code == 404
    assert client.delete("/api/items/nope").status_code == 404


def test_items_list_stays_a_plain_array(client):
    _add(client)
    assert isinstance(client.get("/api/items").json(), list)


def test_starter_closet_is_not_duplicated(client):
    first = client.post("/api/items/starter").json()
    second = client.post("/api/items/starter").json()
    assert len(first) == 8 and {i["id"] for i in second} == {i["id"] for i in first}
    assert len(client.get("/api/items").json()) == 8


def test_worn_counts_up(client):
    item = _add(client).json()
    client.post(f"/api/items/{item['id']}/worn")
    assert client.post(f"/api/items/{item['id']}/worn").json()["wear_count"] == 2


# ------------------------------------------------------------------ uploads

def test_renamed_text_file_is_rejected(client):
    res = client.post("/api/items", data={"meta": '{"name": "x"}'},
                      files={"file": ("fake.jpg", b"definitely not a photo", "image/jpeg")})
    assert res.status_code == 415


def test_gps_exif_is_stripped_from_mirror_photo(client):
    raw = make_image("JPEG", gps=True)
    assert Image.open(io.BytesIO(raw)).getexif().get(0x8825)  # the test photo really has GPS
    profile = client.post("/api/profile/mirror", files={"file": ("me.jpg", raw, "image/jpeg")}).json()
    saved = config.UPLOAD_DIR / profile["mirror_path"]
    exif = Image.open(saved).getexif()
    assert not exif.get(0x8825) and not exif.get(0x0110)


def test_png_cutout_keeps_transparency_and_big_images_shrink(client):
    raw = make_image("PNG", size=(3000, 1000))
    item = client.post("/api/items", data={"meta": '{"name": "Scarf", "category": "accessory"}'},
                       files={"file": ("cut.png", raw, "image/png")}).json()
    img = Image.open(config.UPLOAD_DIR / item["image_path"])
    assert img.mode == "RGBA" and max(img.size) == 2048


# ------------------------------------------------------------------ guardrails

def test_checkout_is_rate_limited_and_429_is_readable(client):
    card = {"number": "5555555555554444", "exp": "12/30", "cvc": "123", "name": "x"}
    codes = [client.post("/api/checkout", json={"product_ids": ["p01"], "card": card}).status_code for _ in range(6)]
    assert codes[:5] == [402] * 5 and codes[5] == 429
    assert "try again" in client.post("/api/checkout", json={}).json()["detail"]


def test_ai_routes_are_limited_per_user_without_touching_their_router(client, as_user):
    client.post("/api/items/starter")
    codes = [client.post("/api/ai/weak-spots").status_code for _ in range(21)]
    assert codes.count(429) == 1
    # Another sign-in token is a different bucket.
    assert client.post("/api/ai/weak-spots", headers={"Authorization": "Bearer someone-else"}).status_code == 200


def test_health_reports_booleans_only(client):
    body = client.get("/api/health").json()
    assert set(body) == {"ok", "supabase", "groq", "perceptron"} and all(isinstance(v, bool) for v in body.values())


def test_429_keeps_cors_headers_so_the_frontend_can_read_it(client):
    origin = config.FRONTEND_ORIGINS[0]
    for _ in range(6):
        res = client.post("/api/checkout", json={}, headers={"Origin": origin})
    assert res.status_code == 429 and res.headers.get("access-control-allow-origin") == origin
