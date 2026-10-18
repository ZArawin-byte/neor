"""Image upload checks shared by profile and closet routes."""
from fastapi import HTTPException, UploadFile

MAX_UPLOAD = 8 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


async def read_image(file: UploadFile) -> tuple[bytes, str, str]:
    if file.content_type not in IMAGE_TYPES:
        raise HTTPException(415, "Please upload a JPG, PNG or WebP image")
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Image too large (8MB max)")
    return data, IMAGE_TYPES[file.content_type], file.content_type
