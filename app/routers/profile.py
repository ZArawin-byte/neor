"""Profile, mirror photo and "forget me". Owner: core lane."""
from fastapi import APIRouter, Depends, File, UploadFile

from .. import store
from ..deps import current_user
from ..schemas import ProfilePatch
from ..uploads import read_image

router = APIRouter()


@router.get("/api/profile")
def get_profile(uid: str = Depends(current_user)):
    return store.get_profile(uid)


@router.put("/api/profile")
def put_profile(patch: ProfilePatch, uid: str = Depends(current_user)):
    # Only the fields the client sent; unknown keys were already dropped by the model.
    return store.save_profile(uid, patch.model_dump(exclude_unset=True, mode="json"))


@router.post("/api/profile/mirror")
async def upload_mirror(file: UploadFile = File(...), uid: str = Depends(current_user)):
    data, ext, ctype = await read_image(file)
    return store.save_mirror(uid, data, ext, ctype)


@router.delete("/api/me")
def forget_me(uid: str = Depends(current_user)):
    store.delete_everything(uid)
    return {"ok": True}
