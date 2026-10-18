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


@pytest.fixture
def as_user(client):
    """Switch the signed-in user, to prove one person can't reach another's data."""
    from app.deps import current_user
    from app.main import app

    def switch(uid: str):
        app.dependency_overrides[current_user] = lambda: uid

    yield switch
    app.dependency_overrides.clear()


def make_image(fmt: str = "JPEG", gps: bool = False, size=(64, 48)) -> bytes:
    import io

    from PIL import Image

    img = Image.new("RGBA" if fmt == "PNG" else "RGB", size, (200, 120, 90))
    out = io.BytesIO()
    if gps:
        exif = img.getexif()
        exif[0x0110] = "NeorCam"  # camera model
        exif[0x8825] = {1: "N", 2: (47.0, 39.0, 0.0), 3: "W", 4: (122.0, 18.0, 0.0)}  # GPS IFD
        img.save(out, fmt, exif=exif)
    else:
        img.save(out, fmt)
    return out.getvalue()
