"""Core lane: the bag and the simulated Visa-only checkout."""
import logging

VISA = {"number": "4242 4242 4242 4242", "exp": "12/30", "cvc": "123", "name": "Ada"}


def _pay(client, card=VISA, headers=None, **body):
    return client.post("/api/checkout", json={"product_ids": ["p01"], "card": card, **body}, headers=headers or {})


def test_visa_test_card_is_accepted_and_labelled_simulated(client):
    order = _pay(client).json()
    assert order["payment_mode"] == "simulated" and order["card"] == {**order["card"], "network": "visa", "last4": "4242"}
    assert "number" not in order["card"] and "cvc" not in order["card"]
    arriving = [i for i in client.get("/api/items").json() if i.get("status") == "arriving"]
    assert arriving[0]["catalog_id"] == "p01"


def test_mastercard_is_refused_as_visa_only(client):
    res = _pay(client, card={**VISA, "number": "5555 5555 5555 4444"})
    assert res.status_code == 402 and "Visa only" in res.json()["detail"]


def test_real_looking_visa_is_refused(client):
    # Passes the old checksum check, but it isn't a test card: a real number must never be "charged".
    res = _pay(client, card={**VISA, "number": "4012 8888 8888 1881"})
    assert res.status_code == 402 and "test card" in res.json()["detail"]


def test_expired_card_and_bad_cvc(client):
    assert _pay(client, card={**VISA, "exp": "01/20"}).status_code == 402
    assert _pay(client, card={**VISA, "cvc": "12"}).status_code == 402


def test_over_budget_needs_confirmation(client):
    client.put("/api/profile", json={"budget": 50})
    assert _pay(client).status_code == 409  # p01 costs 58
    assert _pay(client, confirm_over_budget=True).status_code == 200


def test_same_idempotency_key_returns_the_same_order(client):
    first = _pay(client, headers={"Idempotency-Key": "abc-123"}).json()
    again = _pay(client, headers={"Idempotency-Key": "abc-123"}).json()
    assert first["id"] == again["id"] and len(client.get("/api/orders").json()["orders"]) == 1
    assert client.get("/api/profile").json()["points"] == 58


def test_bag_product_vs_idea_and_checkout_from_bag(client):
    product = client.post("/api/bag", json={"catalog_id": "p18", "reason": "No layering piece", "source": "critique"}).json()
    idea = client.post("/api/bag", json={"title": "Black waterproof ankle boots"}).json()
    assert product["kind"] == "product" and product["title"] == "Trench Coat" and idea["kind"] == "idea"
    assert client.post("/api/bag", json={"catalog_id": "p18"}).json()["id"] == product["id"]  # no duplicates
    assert client.post("/api/checkout", json={"bag_ids": [idea["id"]], "card": VISA}).status_code == 400
    order = client.post("/api/checkout", json={"bag_ids": [product["id"]], "card": VISA}).json()
    assert order["items"][0]["id"] == "p18"
    assert client.get("/api/bag", params={"status": "bought"}).json()[0]["id"] == product["id"]


def test_bag_validation(client):
    assert client.post("/api/bag", json={}).status_code == 422
    assert client.post("/api/bag", json={"catalog_id": "nope"}).status_code == 404
    assert client.post("/api/bag", json={"title": "x", "source": "hacker"}).status_code == 422


def test_other_users_bag_is_off_limits(client, as_user):
    as_user("alice")
    entry = client.post("/api/bag", json={"catalog_id": "p09"}).json()
    as_user("bob")
    assert client.get("/api/bag").json() == []
    assert client.patch(f"/api/bag/{entry['id']}", json={"priority": "high"}).status_code == 404
    assert client.delete(f"/api/bag/{entry['id']}").status_code == 404
    assert client.post("/api/checkout", json={"bag_ids": [entry["id"]], "card": VISA}).status_code == 404


def test_card_number_never_reaches_the_logs(client, caplog):
    caplog.set_level(logging.DEBUG)
    _pay(client)
    _pay(client, card={**VISA, "number": "4012888888881881"})
    assert "4242424242424242" not in caplog.text and "4012888888881881" not in caplog.text
    assert "4242 4242 4242 4242" not in caplog.text


def test_cost_per_wear_drops_as_you_wear_it(client):
    _pay(client)
    item = next(i for i in client.get("/api/items").json() if i.get("catalog_id") == "p01")
    client.post(f"/api/items/{item['id']}/worn")
    client.post(f"/api/items/{item['id']}/worn")
    cpw = client.get("/api/orders").json()["cost_per_wear"][0]
    assert cpw["wear_count"] == 2 and cpw["cost_per_wear"] == 29.0
