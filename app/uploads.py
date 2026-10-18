"""Image upload checks shared by profile and closet routes.

Every photo is opened with Pillow (so a renamed text file is rejected), turned upright, shrunk to
2048px at most, and re-saved without metadata. Re-saving drops EXIF, including GPS location, which
matters most for full-body mirror photos.
"""
import io

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD = 8 * 1024 * 1024
MAX_SIDE = 2048
IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_FORMATS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"), "WEBP": ("webp", "image/webp"),
            "MPO": ("jpg", "image/jpeg")}  # iPhone photos: a JPEG with an extra depth/preview frame


def clean_image(data: bytes) -> tuple[bytes, str, str]:
    """Validate real image bytes and return (clean bytes, extension, content type)."""
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        img = Image.open(io.BytesIO(data))
        fmt = img.format
        img.load()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise HTTPException(415, "That file isn't a photo we can read. Please upload a JPG, PNG or WebP image")
    if fmt not in _FORMATS:
        raise HTTPException(415, "Please upload a JPG, PNG or WebP image")

    img = ImageOps.exif_transpose(img)  # keep phone photos upright once the orientation tag is gone
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    ext, ctype = _FORMATS[fmt]
    out = io.BytesIO()
    if fmt in ("JPEG", "MPO"):  # MPO is saved as a plain JPEG: first frame only, no metadata
        img.convert("RGB").save(out, "JPEG", quality=90, optimize=True)
    elif fmt == "PNG":
        img.save(out, "PNG", optimize=True)  # keeps the transparent background of cut-outs
    else:
        img.save(out, "WEBP", quality=90)
    return out.getvalue(), ext, ctype


async def read_image(file: UploadFile) -> tuple[bytes, str, str]:
    if file.content_type not in IMAGE_TYPES:
        raise HTTPException(415, "Please upload a JPG, PNG or WebP image")
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Image too large (8MB max)")
    return clean_image(data)
