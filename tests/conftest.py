"""Every test runs in demo mode against a throwaway local store: no keys, no network."""
import pytest
from fastapi.testclient import TestClient

from app import config, store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "USE_SUPABASE", False)
    monkeypatch.setattr(config, "USE_GROQ", False)
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    (tmp_path / "uploads").mkdir()
    monkeypatch.setattr(store, "_DB_FILE", tmp_path / "local_db.json")
    from app.main import app

    return TestClient(app)
