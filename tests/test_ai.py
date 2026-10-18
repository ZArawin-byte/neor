"""AI lane: Groq is replaced by a fake client, so these run offline and prove the guardrails."""
import json
from types import SimpleNamespace

import httpx
import pytest

from app import ai, config
from app.context import places, weather
from tests.conftest import make_image

REAL_GET_WEATHER = weather.get_weather  # kept before the autouse stub replaces it
SUNNY = {"temp_c": 8.0, "precip_prob": 70, "wind_kmh": 6.0, "condition": "light rain", "source": "open-meteo",
         "fetched_at": "2026-10-18T07:00:00+00:00", "place": "Gas Works Park, Washington, US"}


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    """No test may touch the network: weather is stubbed and the places cache starts empty."""
    monkeypatch.setattr(weather, "get_weather", lambda place, date=None: None)
    monkeypatch.setattr(config, "USE_PERCEPTRON", False)
    places._cache.clear()


class FakeGroq:
    """Stands in for groq.Groq. Each queued reply is a string (the model's content) or an Exception to raise."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        reply = self.replies.pop(0) if self.replies else "{}"
        if isinstance(reply, Exception):
            raise reply
        content = reply if isinstance(reply, str) else json.dumps(reply)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

    def prompt_text(self) -> str:
        return json.dumps([c["messages"] for c in self.calls])


@pytest.fixture
def fake(client, monkeypatch):
    """Turn the AI on with a fake Groq. Use fake.load(*replies) to queue model output."""
    monkeypatch.setattr(config, "USE_GROQ", True)
    holder = SimpleNamespace(groq=FakeGroq())

    def load(*replies):
        holder.groq = FakeGroq(*replies)
        return holder.groq

    holder.load = load
    monkeypatch.setattr(ai, "client", lambda: holder.groq)
    return holder


def outfit_reply(ids, missing=()):
    return {"title": "Library day", "vibe": "calm", "closet_ids": list(ids), "why": "Neutrals with one accent.",
            "styling_tip": "Roll the sleeves.", "scent": "woody", "cultural_note": "",
            "missing": [{"catalog_id": m, "why": "fills a gap"} for m in missing]}


def starter(client):
    return client.post("/api/items/starter").json()


# ------------------------------------------------------------------ the pipeline

def test_valid_output_is_used(client, fake):
    items = starter(client)
    g = fake.load(outfit_reply(["i1", "i2"]))
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    owned = {i["id"] for i in items}
    assert out["ai"] == "groq" and len(out["closet_ids"]) == 2 and set(out["closet_ids"]) <= owned
    assert not any(i in g.prompt_text() for i in owned)  # the model only ever sees aliases
    rf = fake.groq.calls[0]["response_format"]
    assert rf["type"] == "json_schema" and rf["json_schema"]["strict"] is True
    assert rf["json_schema"]["schema"]["additionalProperties"] is False


def test_malformed_json_retries_once_then_succeeds(client, fake):
    items = starter(client)
    g = fake.load("{not json", outfit_reply([items[0]["id"]]))
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    assert out["ai"] == "groq" and len(g.calls) == 2
    assert "did not validate" in g.calls[1]["messages"][-1]["content"]


def test_malformed_twice_falls_back(client, fake):
    starter(client)
    g = fake.load("{not json", "still not json")
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    assert out["ai"] == "rules" and out["fallback_reason"] == "invalid_output" and len(g.calls) == 2


def test_wrong_types_fall_back(client, fake):
    starter(client)
    bad = {**outfit_reply([]), "closet_ids": "not-a-list", "missing": 5}
    fake.load(bad, bad)
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    assert out["fallback_reason"] == "invalid_output"


def test_invented_ids_are_dropped(client, fake):
    items = starter(client)
    fake.load(outfit_reply(["i1", "i999", items[0]["id"], "made-up-shirt"], ["p999"]))
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    assert len(out["closet_ids"]) == 1 and out["closet_ids"][0] in {i["id"] for i in items}
    assert all(m["catalog_id"] != "p999" for m in out["missing"])

    fake.load({"reply": "Try these", "picks": [
        {"catalog_id": "p01", "why": "crisp", "pairs_with": [items[1]["id"], "ghost"]},
        {"catalog_id": "p404", "why": "invented", "pairs_with": []}]})
    shop = client.post("/api/ai/shop", json={"message": "a shirt"}).json()
    assert [p["catalog_id"] for p in shop["picks"]] == ["p01"] and shop["picks"][0]["pairs_with"] == [items[1]["id"]]


def test_timeout_falls_back(client, fake):
    starter(client)
    fake.load(TimeoutError("slow"))
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    assert out["ai"] == "rules" and out["fallback_reason"] == "provider_error"


def test_no_key_uses_rules_without_calling(client, fake, monkeypatch):
    monkeypatch.setattr(config, "USE_GROQ", False)
    starter(client)
    for path, body in (("/api/ai/outfit", {"occasion": "uni"}), ("/api/ai/weak-spots", None),
                       ("/api/ai/shop", {"message": "boots"}), ("/api/ai/care", {"catalog_id": "p02"})):
        out = client.post(path, json=body).json()
        assert out["ai"] == "rules" and out["fallback_reason"] == "no_key", path
    assert fake.groq.calls == []


def test_consent_off_uses_rules_without_calling(client, fake):
    starter(client)
    client.put("/api/profile", json={"ai_consent": False})
    for path, body in (("/api/ai/outfit", {"occasion": "uni"}), ("/api/ai/shop", {"message": "boots"}),
                       ("/api/ai/care", {"catalog_id": "p02"})):
        assert client.post(path, json=body).json()["fallback_reason"] == "consent_off", path
    tag = client.post("/api/items/analyze", files={"file": ("a.jpg", make_image(), "image/jpeg")}).json()
    assert tag["fallback_reason"] == "consent_off"
    assert fake.groq.calls == []


def test_laundry_never_reaches_prompt_or_rules(client, fake, monkeypatch):
    items = starter(client)
    dirty = items[0]
    client.patch(f"/api/items/{dirty['id']}", json={"laundry": True, "name": "Laundry Secret Tee"})
    g = fake.load(outfit_reply(["i1", "i2", "i3", "i4", "i5", "i6", "i7", "i8"]))
    out = client.post("/api/ai/outfit", json={"occasion": dirty["occasions"][0]}).json()
    assert "Laundry Secret Tee" not in g.prompt_text() and dirty["id"] not in g.prompt_text()
    assert dirty["id"] not in out["closet_ids"]

    monkeypatch.setattr(config, "USE_GROQ", False)
    for occ in ("everyday", "uni", "gym", "birthday"):
        assert dirty["id"] not in client.post("/api/ai/outfit", json={"occasion": occ}).json()["closet_ids"]


def test_identity_never_in_prompt(client, fake):
    starter(client)
    client.put("/api/profile", json={"name": "Zuleika Quartermaine", "age": 19, "gender": "nonbinary-x",
                                     "pronouns": "xe/xem", "tradition": "Tradition-Q", "styles": ["classic"],
                                     "measurements": {"height_cm": 171.25}})
    g = fake.load(outfit_reply([]), {"reply": "ok", "picks": []})
    client.post("/api/ai/outfit", json={"occasion": "uni"})
    client.post("/api/ai/shop", json={"message": "what size fits me?"})
    text = g.prompt_text()
    for secret in ("Zuleika", "Quartermaine", "nonbinary-x", "xe/xem", "Tradition-Q"):
        assert secret not in text
    assert "classic" in text
    assert "171.25" not in text  # measurements need ai_consent=true AND a fit question


def test_measurements_only_with_consent_and_fit_question(client, fake):
    client.put("/api/profile", json={"ai_consent": True, "measurements": {"height_cm": 171.25}})
    g = fake.load({"reply": "ok", "picks": []}, {"reply": "ok", "picks": []})
    client.post("/api/ai/shop", json={"message": "show me coats"})
    assert "171.25" not in g.prompt_text()
    client.post("/api/ai/shop", json={"message": "will this fit if I'm tall?"})
    assert "171.25" in json.dumps(g.calls[1]["messages"])


def test_free_text_and_history_are_capped(client, fake):
    g = fake.load({"reply": "ok", "picks": []})
    history = [{"role": "user", "content": f"turn-{n}"} for n in range(20)]
    client.post("/api/ai/shop", json={"message": "x" * 5000, "history": history})
    text = g.prompt_text()
    assert "x" * 201 not in text and "x" * 200 in text
    assert "turn-11" not in text and "turn-12" in text and "turn-19" in text


def test_logs_never_carry_content(client, fake, caplog):
    items = starter(client)
    fake.load(outfit_reply([items[0]["id"]]))
    with caplog.at_level("INFO", logger="neor.ai"):
        client.post("/api/ai/outfit", json={"occasion": "secret-gala"})
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "feature=outfit" in logged and "engine=groq" in logged
    assert "secret-gala" not in logged and items[0]["name"] not in logged


def test_tag_hedges_material_and_returns_rack(client, fake):
    fake.load({"name": "Cream Knit", "category": "top", "color": "cream", "hex": "#efe6d2", "material": "wool blend",
               "styles": ["classic"], "seasons": ["winter"], "occasions": ["uni", "party"], "rack": "sweaters",
               "confidence": 1.7})
    out = client.post("/api/items/analyze", files={"file": ("a.jpg", make_image(), "image/jpeg")}).json()
    assert out["ai"] == "groq" and out["rack"] == "sweaters" and out["confidence"] == 1.0
    assert out["material"] == "likely wool blend" and out["occasions"] == ["uni"]


def test_provider_schema_rejection_gets_the_retry(client, fake):
    items = starter(client)
    g = fake.load(RuntimeError("Error code: 400 - json_validate_failed"), outfit_reply([items[0]["id"]]))
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    assert out["ai"] == "groq" and len(g.calls) == 2


def test_rate_limit_switches_to_fast_model(client, fake):
    class RateLimitError(Exception):
        pass

    items = starter(client)
    g = fake.load(RateLimitError("429"), outfit_reply([items[0]["id"]]))
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    assert out["ai"] == "groq" and g.calls[1]["model"] == config.GROQ_FAST_MODEL


# ------------------------------------------------------------------ A2: real context data

def test_outfit_returns_real_weather_and_layers_up(client, monkeypatch):
    items = starter(client)
    seen = []
    monkeypatch.setattr(weather, "get_weather", lambda place, date=None: seen.append(place) or SUNNY)
    out = client.post("/api/ai/outfit", json={"occasion": "everyday", "place": "Gas Works Park, Seattle"}).json()
    assert seen == ["Gas Works Park, Seattle"] and out["weather"]["temp_c"] == 8.0
    cats = {i["id"]: i["category"] for i in items}
    assert "outerwear" in {cats[i] for i in out["closet_ids"]}  # cold + rain -> a layer
    assert "8.0°C" in out["why"]


def test_weather_goes_into_the_prompt(client, fake, monkeypatch):
    items = starter(client)
    monkeypatch.setattr(weather, "get_weather", lambda place, date=None: SUNNY)
    g = fake.load(outfit_reply([items[0]["id"]]))
    out = client.post("/api/ai/outfit", json={"occasion": "uni", "travel": "Seattle"}).json()
    assert "light rain" in g.prompt_text() and out["weather"]["source"] == "open-meteo"


def test_pieces_are_kept_and_unknown_pieces_dropped(client, fake):
    items = starter(client)
    g = fake.load(outfit_reply([items[1]["id"]]))
    out = client.post("/api/ai/outfit", json={"occasion": "uni", "pieces": [items[3]["id"], "ghost"]}).json()
    assert out["closet_ids"][0] == items[3]["id"] and "ghost" not in g.prompt_text()


def test_get_weather_parses_open_meteo(monkeypatch):
    def handler(req):
        if "geocoding" in req.url.host:
            return httpx.Response(200, json={"results": [{"name": "Seattle", "admin1": "Washington",
                                                          "country_code": "US", "latitude": 47.6, "longitude": -122.3}]})
        return httpx.Response(200, json={"current": {"time": "2026-10-18T01:00", "temperature_2m": 9.44,
                                                     "weather_code": 61, "wind_speed_10m": 12.0},
                                         "hourly": {"time": ["2026-10-18T01:00"], "precipitation_probability": [80]}})

    real = httpx.Client
    monkeypatch.setattr(weather.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    weather._cache.clear()
    w = REAL_GET_WEATHER("Seattle")
    assert w["temp_c"] == 9.4 and w["precip_prob"] == 80 and w["condition"] == "light rain" and weather.is_wet(w)
    assert REAL_GET_WEATHER("hot weather") is None and REAL_GET_WEATHER("wearing: a red scarf") is None
    weather._cache.clear()


def _osm(handler_overpass):
    def handler(req):
        if "nominatim" in req.url.host:
            return httpx.Response(200, json=[{"lat": "47.65", "lon": "-122.30"}])
        return handler_overpass(req)
    return handler


def _patch_places(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(places.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(_osm(handler)), **kw))


ELEMENTS = [
    {"type": "node", "id": 9, "lat": 47.6, "lon": -122.3, "tags": {"name": "Zed Cafe", "amenity": "cafe",
                                                                   "website": "https://zed.example", "opening_hours": "Mo-Su 07:00-18:00"}},
    {"type": "node", "id": 3, "lat": 47.6, "lon": -122.3, "tags": {"name": "Second Life Thrift", "shop": "second_hand"}},
    {"type": "way", "id": 5, "center": {"lat": 47.6, "lon": -122.3}, "tags": {"name": "Gas Works Park", "leisure": "park",
                                                                            "wikimedia_commons": "File:GasWorks.jpg"}},
    {"type": "node", "id": 1, "lat": 47.6, "lon": -122.3, "tags": {"name": "Allegro", "amenity": "cafe"}},
]


def test_places_falls_through_mirrors_sorts_and_passes_tags(client, monkeypatch):
    calls = []

    def overpass(req):
        calls.append(req.url.host)
        if req.url.host == "overpass-api.de":
            return httpx.Response(504)
        assert "second_hand" in httpx.QueryParams(req.content.decode())["data"]
        return httpx.Response(200, json={"elements": list(reversed(ELEMENTS))})

    _patch_places(monkeypatch, overpass)
    first = client.post("/api/ai/places", json={"city": "Seattle"}).json()
    second = client.post("/api/ai/places", json={"city": "Seattle"}).json()
    assert calls == ["overpass-api.de", "overpass.kumi.systems"]  # second call came from the cache
    assert first == second
    assert [p["name"] for p in first["picks"]] == ["Allegro", "Zed Cafe", "Gas Works Park", "Second Life Thrift"]
    zed = first["picks"][1]
    assert zed["website"] == "https://zed.example" and zed["opening_hours"].startswith("Mo-Su")
    assert first["picks"][2]["wikimedia_commons"] == "File:GasWorks.jpg"


def test_places_all_mirrors_down_gives_reason(client, monkeypatch):
    _patch_places(monkeypatch, lambda req: httpx.Response(500))
    out = client.post("/api/ai/places", json={"city": "Seattle"}).json()
    assert out["picks"] == [] and "busy" in out["reason"] and out["center"] == [47.65, -122.30]


def test_places_nominatim_down_is_503(client, monkeypatch):
    def boom(req):
        raise httpx.ConnectError("down")

    real = httpx.AsyncClient
    monkeypatch.setattr(places.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(boom), **kw))
    r = client.post("/api/ai/places", json={"city": "Seattle"})
    assert r.status_code == 503 and r.json()["detail"] == "Places search is unavailable right now"


def test_care_uses_knowledge_base_and_marks_owned_estimates(client):
    out = client.post("/api/ai/care", json={"catalog_id": "p02"}).json()  # 80% wool, 20% cashmere
    assert any("never wring" in s.lower() for s in out["care_steps"]) and "tier_basis" not in out
    item = client.post("/api/items", data={"meta": '{"name": "Linen shirt", "category": "top", "material": "linen"}'}).json()
    mine = client.post("/api/ai/care", json={"item_id": item["id"]}).json()
    assert mine["tier_basis"] == "estimate from material" and "linen" in mine["material_explainer"].lower()


def test_analyze_rules_path_still_returns_rack_and_confidence(client):
    out = client.post("/api/items/analyze", files={"file": ("a.jpg", make_image(), "image/jpeg")}).json()
    assert out["rack"] == "tshirts" and out["confidence"] == 0.0 and out["material"].startswith("unknown")


# ------------------------------------------------------------------ A3: the stylist

def test_harmony_port_matches_color_ts():
    from app.stylist import harmony_of

    # Expected values were produced by running frontend/src/lib/color.ts harmonyOf() on the same palettes.
    cases = {
        ("#f5f2ea", "#2c3e66", "#fafafa"): ("Tonal neutrals", 84, "neutral", "high"),
        ("#d98fa0", "#1d1d1f"): ("Single accent", 90, "warm", "high"),
        ("#d98fa0", "#9caf88"): ("Split contrast", 76, "warm", "low"),
        ("#c3b1e1", "#6b6b3a", "#e7a1b0"): ("Competing colours", 52, "warm", "medium"),
        ("#3d6c9c", "#c8862a"): ("Complementary", 78, "mixed", "low"),
        ("#e9b7bd", "#d98fa0"): ("Analogous", 86, "warm", "low"),
        ("#222226", "#a7a9ac"): ("Tonal neutrals", 84, "neutral", "high"),
    }
    for hexes, want in cases.items():
        h = harmony_of(list(hexes))
        assert (h["name"], h["score"], h["temperature"], h["contrast"]) == want, hexes


def test_rules_outfit_is_deterministic(client):
    import random

    from app import stylist
    from app.seed import STARTER_CLOSET

    closet = [{**i, "id": f"s{n}"} for n, i in enumerate(STARTER_CLOSET, 1)]
    ctx = stylist.context({"styles": ["classic"]}, "uni", "fall", {"temp_c": 6, "precip_prob": 80,
                                                                    "condition": "rain", "wind_kmh": 5})
    first = stylist.build(closet, ctx)
    for seed in range(5):
        shuffled = closet[:]
        random.Random(seed).shuffle(shuffled)
        assert stylist.build(shuffled, ctx)["outfits"] == first["outfits"]
    assert len(first["outfits"]) == 3

    starter(client)
    a = client.post("/api/ai/outfit", json={"occasion": "uni", "season": "fall"}).json()
    b = client.post("/api/ai/outfit", json={"occasion": "uni", "season": "fall"}).json()
    assert a == b and a["ai"] == "rules" and a["closet_ids"]


def test_rules_reasons_come_from_scores(client):
    starter(client)
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    assert "tagged for uni" in out["why"] and "/100" in out["why"] and out["harmony"]["score"] > 0


def test_groq_only_sees_and_returns_the_shortlist(client, fake):
    items = starter(client)
    g = fake.load(outfit_reply(["i2", "i3", "i404"]))
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    prompt = g.prompt_text()
    assert "SHORTLIST" in prompt and "READY OUTFITS" in prompt and "CATALOG:" not in prompt
    assert len(out["closet_ids"]) == 2 and set(out["closet_ids"]) <= {i["id"] for i in items}


def test_missing_slot_respects_modesty_and_budget(client):
    client.post("/api/items", data={"meta": '{"name": "White tee", "category": "top", "hex": "#ffffff", "occasions": ["birthday"]}'})
    client.post("/api/items", data={"meta": '{"name": "Black jeans", "category": "bottom", "hex": "#111111", "occasions": ["birthday"]}'})
    client.put("/api/profile", json={"modesty": "modest", "budget": 100})
    out = client.post("/api/ai/outfit", json={"occasion": "birthday"}).json()
    from app.seed import CATALOG_BY_ID

    assert out["missing"], "no shoes in the closet, so a pair should be suggested"
    for m in out["missing"]:
        p = CATALOG_BY_ID[m["catalog_id"]]
        assert p["modest"] and p["price"] <= 100 and m["why"]


def test_favourite_looks_boost_their_pieces(client):
    from app import stylist

    items = starter(client)
    tops = [i for i in items if i["category"] == "top"]
    loved = sorted(tops, key=lambda i: i["id"])[-1]
    ctx = stylist.context({}, "uni")
    base = stylist.score_item(loved, ctx)[0]
    boosted = stylist.score_item(loved, stylist.context({}, "uni", liked={loved["id"]}))[0]
    assert boosted == base + 1
    client.post("/api/looks", json={"name": "Fave", "favorite": True, "pieces": [
        {"key": "k1", "source": "closet", "refId": loved["id"], "x": 50, "y": 50, "rot": 0,
         "snap": {"name": loved["name"], "hex": "#888888", "rack": "tshirts"}}]})
    from app.routers.ai_routes import liked_ids

    assert loved["id"] in liked_ids(config.DEMO_USER_ID)


def test_shop_tells_the_model_what_you_already_own(client, fake):
    client.post("/api/items", data={"meta": '{"name": "My white sneakers", "category": "shoes", "hex": "#fafafa"}'})
    g = fake.load({"reply": "Skip these, you have a pair.", "picks": []})
    client.post("/api/ai/shop", json={"message": "white sneakers"})
    assert "You already own My white sneakers" in g.prompt_text()


# ------------------------------------------------------------------ A4: critique from real counts

def test_critique_numbers_trace_to_closet_counts(client):
    from app import insights, stylist

    items = starter(client)
    out = client.post("/api/ai/weak-spots").json()
    ev = out["evidence"]
    assert ev["pieces"] == len(items) == 8
    assert ev["categories"]["top"] == sum(i["category"] == "top" for i in items)
    for occ, n in ev["occasions"].items():
        assert n == stylist.count_complete(items, stylist.context({}, occ))
    covered = sum(n > 0 for n in ev["occasions"].values()) / len(ev["occasions"])
    seasons = sum(n > 0 for n in ev["seasons"].values()) / len(ev["seasons"])
    balance = 1.0 if ev["neutrals"] >= 2 and ev["accents"] >= 1 else 0.5
    assert out["score"] == round(100 * (0.6 * covered + 0.3 * seasons + 0.1 * balance))
    for gap in out["gaps"]:
        assert gap["key"] and gap["evidence"] and gap["catalog_ids"]
        from app.seed import CATALOG_BY_ID

        product = {**CATALOG_BY_ID[gap["catalog_ids"][0]], "id": "catalog:x"}
        more = items + [product]
        profile = {}
        occs, seas = tuple(ev["occasions"]), tuple(ev["seasons"])
        expect = (sum(insights.occasion_counts(more, profile, occs).values())
                  + sum(insights.season_counts(more, profile, seas).values())
                  - sum(ev["occasions"].values()) - sum(ev["seasons"].values()))
        assert gap["unlocks"] == expect, gap["key"]


def test_critique_on_an_empty_closet(client):
    out = client.post("/api/ai/weak-spots").json()
    assert out["score"] == 0 and out["evidence"]["pieces"] == 0
    keys = {g["key"] for g in out["gaps"]}
    assert {"empty-top", "empty-bottom", "empty-shoes"} <= keys
    assert all(g["unlocks"] == 0 for g in out["gaps"])  # one piece alone can't complete an outfit


def test_groq_cannot_change_critique_numbers(client, fake):
    starter(client)
    rules = client.post("/api/ai/weak-spots", headers={}).json()
    first = rules["gaps"][0]["key"]
    fake.load({"summary": "A lovely start - 97% perfect!", "gaps": [
        {"key": first, "why": "This unlocks 4000 outfits."},
        {"key": "invented-gap", "why": "Buy everything."}]})
    out = client.post("/api/ai/weak-spots").json()
    assert out["ai"] == "groq" and out["score"] == rules["score"]
    assert [(g["key"], g["unlocks"], g["catalog_ids"]) for g in out["gaps"]] == \
           [(g["key"], g["unlocks"], g["catalog_ids"]) for g in rules["gaps"]]
    assert "97%" not in out["summary"] and "4000" not in out["gaps"][0]["why"]


def test_groq_can_reword_with_real_numbers(client, fake):
    starter(client)
    rules = client.post("/api/ai/weak-spots").json()
    g0 = rules["gaps"][0]
    fake.load({"summary": "A tidy closet with room to grow.",
               "gaps": [{"key": g0["key"], "why": f"Adding it gives you {g0['unlocks']} more outfits."}]})
    out = client.post("/api/ai/weak-spots").json()
    assert out["summary"] == "A tidy closet with room to grow."
    assert out["gaps"][0]["why"] == f"Adding it gives you {g0['unlocks']} more outfits."


# ------------------------------------------------------------------ A5: care labels

LABEL = "80% WOOL\n20% NYLON\nHAND WASH 30°C\nDO NOT BLEACH\nDO NOT TUMBLE DRY\nCOOL IRON"


def _label(client, **data):
    return client.post("/api/items/care-label", files={"file": ("l.jpg", make_image(), "image/jpeg")}, data=data)


def test_label_regex_parses_fibres_and_symbols():
    from app.vision import parse_label

    fibers, care = parse_label(LABEL)
    assert fibers == [{"fiber": "wool", "percent": 80.0}, {"fiber": "nylon", "percent": 20.0}]
    assert care == {"wash_temp_c": 30, "machine_wash": False, "bleach": False, "tumble_dry": False, "iron": True,
                    "dry_clean": None}
    assert parse_label("55% Cotton, 45% Polyester. Machine wash 40C.")[0][1] == {"fiber": "polyester", "percent": 45.0}
    assert parse_label("Shell 100% Polyamide (lining: 100% rayon)")[0] == [
        {"fiber": "nylon", "percent": 100.0}, {"fiber": "viscose", "percent": 100.0}]


def test_label_offline_without_keys(client):
    r = _label(client)
    assert r.status_code == 200
    out = r.json()
    assert out["ai"] == "offline" and out["fiber_composition"] == [] and out["source"] == "label"


def test_label_with_perceptron_and_regex(client, monkeypatch):
    from app import vision

    monkeypatch.setattr(config, "USE_PERCEPTRON", True)
    monkeypatch.setattr(vision, "_ocr_perceptron", lambda image: LABEL)
    item = client.post("/api/items", data={"meta": '{"name": "Jumper", "category": "top"}'}).json()
    out = _label(client, item_id=item["id"]).json()
    assert out["ai"] == "perceptron" and out["fiber_composition"][0] == {"fiber": "wool", "percent": 80.0}
    assert out["care_steps"][0] == "Hand wash only, 30°C or below (label)." and out["saved_to_item"] is True
    saved = next(i for i in client.get("/api/items").json() if i["id"] == item["id"])
    assert saved["fibers"][1]["fiber"] == "nylon" and "WOOL" in saved["care_label"]
    care = client.post("/api/ai/care", json={"item_id": item["id"]}).json()
    assert care["care_basis"] == "care label" and care["care_steps"][0] == "Hand wash only, 30°C or below (label)."


def test_label_model_only_fills_what_regex_missed(client, fake, monkeypatch):
    from app import vision

    monkeypatch.setattr(config, "USE_PERCEPTRON", True)
    monkeypatch.setattr(vision, "_ocr_perceptron", lambda image: "100% COTTON")
    fake.load({"text": "100% COTTON", "fiber_composition": [{"fiber": "silk", "percent": 100}],
               "care": {"wash_temp_c": 40, "machine_wash": True, "bleach": None, "tumble_dry": None, "iron": None,
                        "dry_clean": None}})
    out = _label(client).json()
    assert out["fiber_composition"] == [{"fiber": "cotton", "percent": 100.0}]  # regex wins
    assert out["care"]["wash_temp_c"] == 40 and out["care"]["machine_wash"] is True  # model filled the gaps


def test_label_perceptron_error_falls_back_to_groq(client, fake, monkeypatch):
    from app import vision

    def boom(image):
        raise RuntimeError("quota")

    monkeypatch.setattr(config, "USE_PERCEPTRON", True)
    monkeypatch.setattr(vision, "_ocr_perceptron", boom)
    fake.load({"text": LABEL, "fiber_composition": [], "care": {
        "wash_temp_c": None, "machine_wash": None, "bleach": None, "tumble_dry": None, "iron": None, "dry_clean": None}})
    out = _label(client).json()
    assert out["ai"] == "groq" and out["fiber_composition"][0]["fiber"] == "wool"


def test_label_never_saves_to_someone_elses_item(client, as_user, monkeypatch):
    from app import vision

    monkeypatch.setattr(config, "USE_PERCEPTRON", True)
    monkeypatch.setattr(vision, "_ocr_perceptron", lambda image: LABEL)
    as_user("alice")
    item = client.post("/api/items", data={"meta": '{"name": "Alice coat", "category": "outerwear"}'}).json()
    as_user("mallory")
    assert _label(client, item_id=item["id"]).json()["saved_to_item"] is False
    as_user("alice")
    assert "care_label" not in next(i for i in client.get("/api/items").json() if i["id"] == item["id"])


COSTCO = ("MACHINE WASH COLD WITH LIKE COLORS. ONLY NON-CHLORINE BLEACH WHEN NEEDED. TUMBLE DRY LOW. "
          "COOL IRON IF NEEDED. DO NOT IRON ON DECORATION. DO NOT DRY CLEAN.\n\n"
          "LAVAR A MAQUINA CON AGUA FRIA Y COLORES SIMILARES. NO LIMPIAR A SECO.")


def test_real_label_qualifiers_are_kept():
    """A real label (read by Perceptron): 'do not iron ON DECORATION' must not become 'do not iron'."""
    from app.vision import label_phrases, parse_label

    fibers, care = parse_label(COSTCO)
    assert fibers == []  # this tag has no composition; it lives on another tag
    assert care == {"wash_temp_c": 30, "machine_wash": True, "bleach": True, "tumble_dry": True, "iron": True,
                    "dry_clean": False}
    assert label_phrases(COSTCO) == [
        "Machine wash cold (label).", "Wash with similar colours (label).",
        "Only non-chlorine bleach, and only when needed (label).", "Tumble dry low (label).",
        "Cool iron if needed (label).", "Don't iron over the decoration or print (label).",
        "Do not dry clean (label)."]
    assert parse_label("DO NOT IRON.")[1]["iron"] is False
