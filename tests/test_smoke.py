"""One request per existing endpoint, so a refactor that breaks the frontend's contract fails CI."""


def test_health_and_config(client):
    assert client.get("/").json()["ok"] is True
    assert client.get("/api/config").json()["demo"] is True


def test_profile_round_trip(client):
    client.put("/api/profile", json={"name": "Ada", "styles": ["classic"], "not_allowed": 1})
    profile = client.get("/api/profile").json()
    assert profile["name"] == "Ada" and "not_allowed" not in profile


def test_closet_crud_and_starter(client):
    assert len(client.post("/api/items/starter").json()) == 8
    item = client.post("/api/items", data={"meta": '{"name": "Red Scarf", "category": "accessory"}'}).json()
    assert client.patch(f"/api/items/{item['id']}", json={"laundry": True}).json()["ok"]
    assert any(i["id"] == item["id"] and i["laundry"] for i in client.get("/api/items").json())
    client.delete(f"/api/items/{item['id']}")
    assert all(i["id"] != item["id"] for i in client.get("/api/items").json())


def test_ai_routes_fall_back_to_rules(client):
    client.post("/api/items/starter")
    assert client.post("/api/ai/outfit", json={"occasion": "uni"}).json()["ai"] == "rules"
    assert client.post("/api/ai/weak-spots").json()["ai"] == "rules"
    assert client.post("/api/ai/shop", json={"message": "white sneakers"}).json()["ai"] == "rules"
    assert client.post("/api/ai/care", json={"catalog_id": "p02"}).json()["ai"] == "rules"


def test_catalog_checkout_orders(client):
    assert len(client.get("/api/catalog").json()) == 30
    card = {"number": "4242 4242 4242 4242", "exp": "12/30", "cvc": "123", "name": "Ada"}
    assert client.post("/api/checkout", json={"product_ids": ["p01"], "card": {**card, "number": "5555555555554444"}}).status_code == 402
    order = client.post("/api/checkout", json={"product_ids": ["p01"], "card": card}).json()
    assert order["card"]["last4"] == "4242"
    assert client.get("/api/orders").json()["orders"][0]["id"] == order["id"]


def test_forget_me(client):
    client.post("/api/items/starter")
    client.delete("/api/me")
    assert client.get("/api/items").json() == []
