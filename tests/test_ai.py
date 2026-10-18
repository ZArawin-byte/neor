"""AI lane: Groq is replaced by a fake client, so these run offline and prove the guardrails."""
import json
from types import SimpleNamespace

import pytest

from app import ai, config
from tests.conftest import make_image


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
    fake.load(outfit_reply([items[0]["id"], items[1]["id"]], ["p09"]))
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    assert out["ai"] == "groq" and out["closet_ids"] == [items[0]["id"], items[1]["id"]]
    assert out["missing"][0]["catalog_id"] == "p09"
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
    fake.load(outfit_reply([items[0]["id"], "made-up-shirt"], ["p09", "p999"]))
    out = client.post("/api/ai/outfit", json={"occasion": "uni"}).json()
    assert out["closet_ids"] == [items[0]["id"]]
    assert [m["catalog_id"] for m in out["missing"]] == ["p09"]

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
    g = fake.load(outfit_reply([dirty["id"], items[1]["id"]]))
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
