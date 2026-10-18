"""Bookmark-table boards and archived looks, so they follow you between devices. Owner: core lane.

Shapes match Board and Look in frontend/src/lib/types.ts. The browser makes the ids, so a board saved
offline keeps the same id once it syncs.
"""
import datetime as dt
import secrets

from fastapi import APIRouter, Depends, HTTPException

from .. import store
from ..deps import current_user
from ..schemas import BoardIn, LookIn, LookPatch

router = APIRouter()


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


@router.get("/api/boards")
def list_boards(uid: str = Depends(current_user)):
    return store.list_boards(uid)


@router.post("/api/boards")
def save_board(board: BoardIn, uid: str = Depends(current_user)):
    data = {**board.model_dump(mode="json"), "id": board.id or secrets.token_hex(8), "savedAt": _now()}
    if board.id and store.get_board(uid, board.id):  # saving an existing table again replaces it
        return store.update_board(uid, board.id, data)
    return store.add_board(uid, data)


@router.delete("/api/boards/{board_id}")
def delete_board(board_id: str, uid: str = Depends(current_user)):
    if not store.delete_board(uid, board_id):
        raise HTTPException(404, "Board not found")
    return {"ok": True}


@router.get("/api/looks")
def list_looks(uid: str = Depends(current_user)):
    return store.list_looks(uid)


@router.post("/api/looks")
def save_look(look: LookIn, uid: str = Depends(current_user)):
    if look.id and store.get_look(uid, look.id):
        return store.get_look(uid, look.id)  # already synced
    return store.add_look(uid, {**look.model_dump(mode="json"), "id": look.id or secrets.token_hex(8),
                                "savedAt": look.savedAt or _now()})


@router.patch("/api/looks/{look_id}")
def update_look(look_id: str, patch: LookPatch, uid: str = Depends(current_user)):
    updated = store.update_look(uid, look_id, patch.model_dump(exclude_unset=True, mode="json"))
    if updated is None:
        raise HTTPException(404, "Look not found")
    return updated


@router.delete("/api/looks/{look_id}")
def delete_look(look_id: str, uid: str = Depends(current_user)):
    if not store.delete_look(uid, look_id):
        raise HTTPException(404, "Look not found")
    return {"ok": True}
