"""iPhone photos are often MPO (a JPEG with a second depth/preview frame). They must upload like any JPEG."""
import io

from PIL import Image

from app.uploads import clean_image


def mpo_photo(gps: bool = True) -> bytes:
    first = Image.new("RGB", (80, 60), (220, 140, 160))
    second = Image.new("RGB", (40, 30), (10, 10, 10))
    exif = first.getexif()
    if gps:
        exif[0x8825] = {1: "N", 2: (47.0, 39.0, 0.0), 3: "W", 4: (122.0, 18.0, 0.0)}
    out = io.BytesIO()
    first.save(out, "MPO", save_all=True, append_images=[second], exif=exif)
    return out.getvalue()


def test_mpo_is_accepted_and_saved_as_plain_jpeg():
    data = mpo_photo()
    assert Image.open(io.BytesIO(data)).format == "MPO"
    clean, ext, ctype = clean_image(data)
    img = Image.open(io.BytesIO(clean))
    assert (ext, ctype, img.format) == ("jpg", "image/jpeg", "JPEG")
    assert getattr(img, "n_frames", 1) == 1 and img.size == (80, 60)
    assert 0x8825 not in img.getexif()  # GPS is still stripped


def test_mpo_uploads_through_the_api(client):
    files = {"file": ("IMG_0001.jpg", mpo_photo(), "image/jpeg")}
    assert client.post("/api/items/care-label", files=files).status_code == 200
    item = client.post("/api/items", data={"meta": '{"name": "Pink fleece", "category": "top"}'}, files=files)
    assert item.status_code == 200 and item.json()["image_url"]
