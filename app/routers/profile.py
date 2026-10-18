"""Profile, mirror photo and "forget me". Owner: core lane."""
from fastapi import APIRouter, Depends, File, UploadFile

from .. import store
from ..deps import current_user
from ..uploads import read_image

router = APIRouter()


@router.get("/api/profile")
def get_profile(uid: str = Depends(current_user)):
    return store.get_profile(uid)


@router.put("/api/profile")
def put_profile(patch: dict, uid: str = Depends(current_user)):
    allowed = {"name", "styles", "modesty", "modesty_notes", "measurements", "budget", "scents",
               "colors_love", "colors_avoid", "climate", "theme", "onboarded", "accessories", "ai_consent",
               "age", "gender", "pronouns", "tradition", "dress_rules"}
    return store.save_profile(uid, {k: v for k, v in patch.items() if k in allowed})


@router.post("/api/profile/mirror")
async def upload_mirror(file: UploadFile = File(...), uid: str = Depends(current_user)):
    data, ext, ctype = await read_image(file)
    return store.save_mirror(uid, data, ext, ctype)


@router.delete("/api/me")
def forget_me(uid: str = Depends(current_user)):
    store.delete_everything(uid)
    return {"ok": True}
