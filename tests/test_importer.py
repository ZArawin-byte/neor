"""Core lane: reading a pasted product link. No network: httpx runs on a mock transport."""
import httpx
import pytest

from app import importer
from tests.conftest import make_image

JSONLD_PAGE = """<html><head><title>Ignored | Shop</title>
<meta property="og:image" content="/og.jpg">
<script type="application/ld+json">{"@context": "https://schema.org", "@graph": [
  {"@type": "BreadcrumbList"},
  {"@type": ["Product"], "name": "Merino Crew Sweater", "brand": {"@type": "Brand", "name": "Fjord"},
   "color": "Oatmeal", "material": "100% merino wool", "image": ["https://shop.example/p.jpg"],
   "offers": {"@type": "Offer", "price": "89.00", "priceCurrency": "USD"}}]}</script>
</head></html>"""
OG_PAGE = """<html><head><meta property="og:title" content="Linen Shirt &amp; Co">
<meta property="og:image" content="https://shop.example/og.jpg"><meta property="product:price:amount" content="45"></head></html>"""


def test_jsonld_product_beats_og_tags():
    facts = importer.parse_product_page(JSONLD_PAGE, "https://shop.example/item")
    assert facts == {"title": "Merino Crew Sweater", "price": "89.00", "currency": "USD", "brand": "Fjord",
                     "material": "100% merino wool", "color": "Oatmeal", "image_url": "https://shop.example/p.jpg",
                     "structured": True}


def test_og_fallback_and_broken_jsonld():
    page = OG_PAGE + '<script type="application/ld+json">{not json</script>'
    facts = importer.parse_product_page(page, "https://shop.example/item")
    assert facts["title"] == "Linen Shirt & Co" and facts["price"] == "45" and facts["structured"] is False


@pytest.fixture
def shop(monkeypatch):
    """A fake shop: /item is the product page, the image URLs return a real JPEG, /huge never ends."""
    jpeg = make_image("JPEG")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/item":
            return httpx.Response(200, html=JSONLD_PAGE)
        if request.url.path == "/moved":
            return httpx.Response(302, headers={"location": "/item"})
        if request.url.path == "/huge":
            return httpx.Response(200, content=b"x" * (importer.MAX_PAGE + 10), headers={"content-type": "text/html"})
        return httpx.Response(200, content=jpeg, headers={"content-type": "image/jpeg"})

    monkeypatch.setattr(importer, "is_public", lambda url: "internal" not in url)
    monkeypatch.setattr(importer, "client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def test_import_returns_photo_and_product_facts(client, shop):
    body = client.post("/api/items/import", json={"url": "https://shop.example/moved"}).json()
    assert body["title"] == "Merino Crew Sweater" and body["brand"] == "Fjord" and body["structured"] is True
    assert body["image"].startswith("data:image/jpeg;base64,") and body["source"] == "https://shop.example/moved"


def test_import_refuses_private_hosts_and_oversized_pages(client, shop):
    assert client.post("/api/items/import", json={"url": "http://internal.local/item"}).status_code == 400
    assert client.post("/api/items/import", json={"url": "https://shop.example/huge"}).status_code == 413
