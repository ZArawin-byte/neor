"""Shop the look: real listings for a suggestion, and the product-photo proxy. No network."""
import pytest
from fastapi import HTTPException

from app import config, souq

RAW = {"shopping_results": [
    {"title": "Pleated Midi Skirt", "source": "Lulus", "price": "$54.00", "extracted_price": 54.0,
     "product_link": "https://www.google.com/search?prds=a", "thumbnail": "https://encrypted-tbn0.gstatic.com/shopping?q=a"},
    {"title": "Pre-owned Pleated Skirt", "source": "eBay", "price": "$12.00", "extracted_price": 12.0,
     "product_link": "https://www.google.com/search?prds=b", "thumbnail": "https://encrypted-tbn1.gstatic.com/shopping?q=b"},
    {"title": "No Photo Skirt", "source": "Shop", "price": "$20.00", "product_link": "https://www.google.com/search?prds=c"},
]}


def test_shop_returns_real_new_listings_with_photos(client, as_user, monkeypatch):
    as_user("u1")
    monkeypatch.setattr(config, "SERPAPI_API_KEY", "test")
    seen = {}

    async def fake_search(req, engine):
        seen["q"], seen["engine"] = req.query, engine
        return RAW

    monkeypatch.setattr(souq, "search", fake_search)
    res = client.get("/api/souq/shop", params={"q": "black pleated skirt", "n": 5})
    assert res.status_code == 200
    body = res.json()
    assert seen == {"q": "black pleated skirt", "engine": "google_shopping"}
    # used listings and listings without a photo are left out
    assert [r["title"] for r in body["results"]] == ["Pleated Midi Skirt"]
    r = body["results"][0]
    assert r["url"].startswith("https://") and r["image"].startswith("https://encrypted-tbn0") and r["value"] == 54.0


@pytest.mark.parametrize("url", [
    "https://example.com/a.jpg",
    "http://encrypted-tbn0.gstatic.com/shopping?q=a",
    "https://encrypted-tbn0.gstatic.com.evil.com/a",
    "https://user:pw@encrypted-tbn0.gstatic.com/a",
    "https://169.254.169.254/latest/meta-data",
])
def test_photo_proxy_only_fetches_google_product_photos(client, as_user, url):
    as_user("u1")
    assert client.get("/api/souq/photo", params={"u": url}).status_code == 400


def test_photo_proxy_passes_the_image_through(client, as_user, monkeypatch):
    as_user("u1")

    async def fake_fetch(url):
        return b"RIFF....WEBP", "image/webp"

    monkeypatch.setattr(souq, "fetch_photo", fake_fetch)
    res = client.get("/api/souq/photo", params={"u": "https://encrypted-tbn2.gstatic.com/shopping?q=x"})
    assert res.status_code == 200 and res.headers["content-type"] == "image/webp"


def test_fetch_photo_rejects_non_images(monkeypatch):
    import asyncio

    class FakeResp:
        status_code, headers, content = 200, {"content-type": "text/html"}, b"<html>"

    class FakeClient:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url): return FakeResp()

    monkeypatch.setattr(souq.httpx, "AsyncClient", FakeClient)
    with pytest.raises(HTTPException) as e:
        asyncio.run(souq.fetch_photo("https://encrypted-tbn0.gstatic.com/shopping?q=a"))
    assert e.value.status_code == 502


def test_shop_shows_each_product_once():
    dupes = {"shopping_results": [
        {"title": "Max Mara Belted Coat", "source": s, "price": "$2,300.00", "product_link": f"https://www.google.com/search?prds={i}",
         "thumbnail": "https://encrypted-tbn0.gstatic.com/shopping?q=coat"} for i, s in enumerate(["A", "B", "C"])
    ]}
    assert len(souq.shop_results(dupes, 10)) == 1
