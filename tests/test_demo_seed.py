"""The demo seed runs twice without duplicating, and reset starts it over."""
from scripts.seed_demo import demo_uid, seed

from app import store


def test_seed_is_idempotent_and_reset_works(client):
    uid = demo_uid()
    seed(uid)
    seed(uid)
    assert len(store.list_items(uid)) == 8 and len(store.list_bag(uid)) == 2
    assert len(store.list_boards(uid)) == 2 and store.list_looks(uid)[0]["favorite"] in (True, False)
    store.delete_everything(uid, keep_account=True)
    seed(uid)
    assert len(store.list_items(uid)) == 8
    # Seeded data shows up through the API the frontend uses.
    assert len(client.get("/api/bag").json()) == 2
