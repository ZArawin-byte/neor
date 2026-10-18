"""Wipe ONLY the demo account's data (it keeps the login) and seed it again.

    .venv/bin/python -m scripts.reset_demo
"""
from app import store
from scripts.seed_demo import demo_uid, seed

if __name__ == "__main__":
    uid = demo_uid()
    store.delete_everything(uid, keep_account=True)
    seed(uid)
