"""The bag: things you might buy, each with the reason it was suggested. Owner: core lane.

An entry with a catalog_id is a real (sample-catalog) product and can be checked out.
An entry without one is only an idea, and the API says so with kind="idea".
"""
from fastapi import APIRouter, Depends, HTTPException

from .. import store
from ..deps import current_user
from ..schemas import BagEntryIn, BagEntryPatch
from ..seed import CATALOG_BY_ID

router = APIRouter()


def _present(entry: dict) -> dict:
    product = CATALOG_BY_ID.get(entry.get("catalog_id") or "")
    return {**entry, "kind": "product" if product else "idea", "product": product}


@router.get("/api/bag")
def list_bag(status: str | None = None, priority: str | None = None, uid: str = Depends(current_user)):
    entries = [e for e in store.list_bag(uid)
               if (status is None or e.get("status") == status) and (priority is None or e.get("priority") == priority)]
    return [_present(e) for e in entries]


@router.post("/api/bag")
def add_to_bag(entry: BagEntryIn, uid: str = Depends(current_user)):
    data = entry.model_dump(mode="json")
    if data["catalog_id"]:
        product = CATALOG_BY_ID.get(data["catalog_id"])
        if not product:
            raise HTTPException(404, "That product isn't in the catalog")
        data["title"] = data["title"] or product["name"]
        # Already wanted? Return the existing entry instead of listing it twice.
        dup = next((e for e in store.list_bag(uid) if e.get("catalog_id") == data["catalog_id"] and e.get("status") == "wanted"), None)
        if dup:
            return _present(dup)
    return _present(store.add_bag_entry(uid, data))


@router.patch("/api/bag/{entry_id}")
def update_bag(entry_id: str, patch: BagEntryPatch, uid: str = Depends(current_user)):
    updated = store.update_bag_entry(uid, entry_id, patch.model_dump(exclude_unset=True, mode="json"))
    if updated is None:
        raise HTTPException(404, "Bag entry not found")
    return _present(updated)


@router.delete("/api/bag/{entry_id}")
def remove_from_bag(entry_id: str, uid: str = Depends(current_user)):
    if not store.delete_bag_entry(uid, entry_id):
        raise HTTPException(404, "Bag entry not found")
    return {"ok": True}
