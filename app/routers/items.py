"""Closet items, link import and the starter closet. Owner: core lane."""
import base64
import json

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import importer, store
from ..deps import current_user
from ..schemas import ItemIn, ItemPatch
from ..seed import STARTER_CLOSET
from ..uploads import IMAGE_TYPES, MAX_UPLOAD, read_image

router = APIRouter()


@router.get("/api/items")
def list_items(uid: str = Depends(current_user)):
    return store.list_items(uid)


@router.post("/api/items")
async def add_item(meta: str = Form(...), file: UploadFile | None = File(default=None),
                   uid: str = Depends(current_user)):
    try:
        item = ItemIn.model_validate(json.loads(meta)).model_dump(exclude_none=True, mode="json")
    except (ValueError, TypeError) as e:  # bad JSON or a field that fails validation
        raise HTTPException(422, f"That item's details aren't valid: {e}")
    if file is not None and file.filename:
        data, ext, ctype = await read_image(file)
        return store.add_item(uid, item, data, ext, ctype)
    return store.add_item(uid, item)


@router.patch("/api/items/{item_id}")
def patch_item(item_id: str, patch: ItemPatch, uid: str = Depends(current_user)):
    if not store.update_item(uid, item_id, patch.model_dump(exclude_unset=True, mode="json")):
        raise HTTPException(404, "Item not found")
    return {"ok": True}


@router.post("/api/items/{item_id}/worn")
def mark_worn(item_id: str, uid: str = Depends(current_user)):
    """One more wear: feeds cost-per-wear on the orders page and the stylist's 'most worn' signal."""
    item = store.get_item(uid, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    count = int(item.get("wear_count") or 0) + 1
    store.update_item(uid, item_id, {"wear_count": count})
    return {"ok": True, "wear_count": count}


@router.delete("/api/items/{item_id}")
def remove_item(item_id: str, uid: str = Depends(current_user)):
    if not store.delete_item(uid, item_id):
        raise HTTPException(404, "Item not found")
    return {"ok": True}


class ImportReq(BaseModel):
    url: str = Field(max_length=2000)


@router.post("/api/items/import")
async def import_from_link(req: ImportReq, uid: str = Depends(current_user)):
    """Paste a product link: we read the page's product photo and facts (schema.org data, else og: tags)
    and hand the photo back so the browser can cut it out and tag it like any other upload."""
    url = req.url.strip()
    async with importer.client() as http:
        try:
            page, body, final_url = await importer.fetch(http, url, importer.MAX_PAGE)
        except httpx.HTTPError:
            raise HTTPException(502, "Couldn't open that link")
        if page.status_code >= 400:
            raise HTTPException(502, "That shop wouldn't let us read the page. Save the photo and upload it instead.")

        facts = {"title": "", "price": None, "currency": None, "brand": None, "material": None, "color": None,
                 "structured": False}
        if page.headers.get("content-type", "").startswith("image/"):
            img, img_body = page, body
        else:
            facts = importer.parse_product_page(body.decode(page.charset_encoding or "utf-8", errors="replace"), final_url)
            image_url = facts.pop("image_url")
            if not image_url:
                raise HTTPException(422, "Couldn't find a product photo on that page. Save the photo and upload it instead.")
            try:
                img, img_body, _ = await importer.fetch(http, image_url, MAX_UPLOAD)
            except httpx.HTTPError:
                raise HTTPException(502, "Found the product, but couldn't download its photo")

    ctype = img.headers.get("content-type", "").split(";")[0].strip()
    if ctype not in IMAGE_TYPES:
        raise HTTPException(415, "That photo is in a format we can't use (we need JPG, PNG or WebP)")
    return {**facts, "source": url, "image": f"data:{ctype};base64,{base64.b64encode(img_body).decode()}"}


@router.post("/api/items/starter")
def starter_closet(uid: str = Depends(current_user)):
    # Calling this twice used to add 8 duplicates; now it hands back the starter pieces you already have.
    existing = [i for i in store.list_items(uid) if i.get("starter")]
    if existing:
        return existing
    return [store.add_item(uid, {**i, "starter": True}) for i in STARTER_CLOSET]
