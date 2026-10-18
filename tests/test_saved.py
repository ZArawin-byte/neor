"""Core lane: boards and looks keep the browser's ids and stay private."""

PIECE = {"key": "k1", "source": "closet", "refId": "i1", "x": 40, "y": 30, "rot": -2,
         "snap": {"name": "Grey Tee", "hex": "#a7a9ac", "rack": "tshirts", "image_url": "/uploads/demo-user/a.png"}}


def test_board_keeps_client_id_and_resave_replaces(client):
    b = client.post("/api/boards", json={"id": "abcd1234ef567890", "name": "Table no. 3", "pieces": [PIECE]}).json()
    assert b["id"] == "abcd1234ef567890" and b["savedAt"]
    client.post("/api/boards", json={"id": "abcd1234ef567890", "name": "Renamed", "pieces": [PIECE, PIECE]})
    boards = client.get("/api/boards").json()
    assert len(boards) == 1 and boards[0]["name"] == "Renamed" and len(boards[0]["pieces"]) == 2
    assert client.post("/api/boards", json={"name": "No id"}).json()["id"]


def test_look_favorite_and_delete(client):
    look = client.post("/api/looks", json={"id": "look00000001", "name": "Uni", "pieces": [PIECE],
                                           "photo": "https://x.supabase.co/a.png", "verdict": "Nice", "harmony": "Single accent · 90"}).json()
    assert look["favorite"] is False
    assert client.patch(f"/api/looks/{look['id']}", json={"favorite": True}).json()["favorite"] is True
    assert client.post("/api/looks", json={"id": "look00000001", "name": "dup"}).json()["name"] == "Uni"  # re-sync is a no-op
    assert client.delete(f"/api/looks/{look['id']}").json()["ok"]
    assert client.get("/api/looks").json() == []


def test_embedded_images_and_huge_boards_are_rejected(client):
    assert client.post("/api/looks", json={"name": "x", "photo": "data:image/png;base64,AAAA"}).status_code == 422
    bad = {**PIECE, "snap": {**PIECE["snap"], "image_url": "data:image/png;base64,AAAA"}}
    assert client.post("/api/boards", json={"pieces": [bad]}).status_code == 422
    assert client.post("/api/boards", json={"pieces": [PIECE] * 41}).status_code == 422
    assert client.post("/api/boards", json={"id": "bad id!", "pieces": []}).status_code == 422


def test_other_users_boards_and_looks_are_404(client, as_user):
    as_user("alice")
    b = client.post("/api/boards", json={"pieces": [PIECE]}).json()
    lk = client.post("/api/looks", json={"name": "mine"}).json()
    as_user("bob")
    assert client.get("/api/boards").json() == [] and client.get("/api/looks").json() == []
    assert client.delete(f"/api/boards/{b['id']}").status_code == 404
    assert client.patch(f"/api/looks/{lk['id']}", json={"favorite": True}).status_code == 404
