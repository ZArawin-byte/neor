"""Persistence: Supabase when configured, otherwise a local JSON file (demo mode).

Both backends expose the same functions, so the routes never care which one is live.
Closet photos are kept private: Supabase uses a private bucket + short-lived signed URLs.
"""
import json
import threading
import time
import uuid


from . import config

BUCKET = "closet"
SIGNED_URL_TTL = 60 * 60


# ---------------------------------------------------------------- Supabase

_sb = None


def sb():
    global _sb
    if _sb is None:
        from supabase import create_client

        _sb = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
    return _sb


def user_id_from_token(token: str) -> str | None:
    try:
        res = sb().auth.get_user(token)
        return res.user.id if res and res.user else None
    except Exception:
        return None


def _signed(path: str | None) -> str | None:
    if not path:
        return None
    try:
        res = sb().storage.from_(BUCKET).create_signed_url(path, SIGNED_URL_TTL)
        return res.get("signedURL") or res.get("signedUrl")
    except Exception:
        return None


# ---------------------------------------------------------------- Local JSON

_lock = threading.Lock()
_DB_FILE = config.DATA_DIR / "local_db.json"


def _load() -> dict:
    if _DB_FILE.exists():
        return json.loads(_DB_FILE.read_text())
    return {"profiles": {}, "items": {}, "orders": {}}


def _save(db: dict) -> None:
    _DB_FILE.write_text(json.dumps(db, indent=2))


def _local_upload(uid: str, data: bytes, ext: str) -> str:
    folder = config.UPLOAD_DIR / uid
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    (folder / name).write_bytes(data)
    return f"{uid}/{name}"


# ---------------------------------------------------------------- Shared API


def _upload(uid: str, data: bytes, ext: str, content_type: str) -> str:
    if config.USE_SUPABASE:
        path = f"{uid}/{uuid.uuid4().hex}.{ext}"
        sb().storage.from_(BUCKET).upload(path, data, {"content-type": content_type})
        return path
    return _local_upload(uid, data, ext)


def image_url(path: str | None) -> str | None:
    if not path:
        return None
    if path.startswith("http"):
        return path
    return _signed(path) if config.USE_SUPABASE else f"/uploads/{path}"


def get_profile(uid: str) -> dict:
    if config.USE_SUPABASE:
        rows = sb().table("profiles").select("data").eq("id", uid).execute().data
        profile = rows[0]["data"] if rows else {}
    else:
        profile = _load()["profiles"].get(uid, {})
    profile.setdefault("points", 0)
    profile["mirror_url"] = image_url(profile.get("mirror_path"))
    return profile


def save_profile(uid: str, patch: dict) -> dict:
    current = get_profile(uid)
    current.pop("mirror_url", None)
    current.update({k: v for k, v in patch.items() if k != "mirror_url"})
    if config.USE_SUPABASE:
        sb().table("profiles").upsert({"id": uid, "data": current}).execute()
    else:
        with _lock:
            db = _load()
            db["profiles"][uid] = current
            _save(db)
    return get_profile(uid)


def save_mirror(uid: str, data: bytes, ext: str, content_type: str) -> dict:
    path = _upload(uid, data, ext, content_type)
    return save_profile(uid, {"mirror_path": path})


def _hydrate(item: dict) -> dict:
    item["image_url"] = image_url(item.get("image_path"))
    return item


def list_items(uid: str) -> list[dict]:
    if config.USE_SUPABASE:
        rows = (
            sb().table("closet_items").select("*").eq("user_id", uid)
            .order("created_at", desc=True).execute().data
        )
        items = [{**r["data"], "id": r["id"], "image_path": r["image_path"]} for r in rows]
    else:
        items = list(_load()["items"].get(uid, []))
    return [_hydrate(i) for i in items]


def add_item(uid: str, item: dict, image: bytes | None = None, ext: str = "jpg",
             content_type: str = "image/jpeg") -> dict:
    image_path = item.pop("image_path", None)
    if image:
        image_path = _upload(uid, image, ext, content_type)
    item.pop("image_url", None)
    item.pop("id", None)
    if config.USE_SUPABASE:
        row = sb().table("closet_items").insert(
            {"user_id": uid, "data": item, "image_path": image_path}
        ).execute().data[0]
        return _hydrate({**row["data"], "id": row["id"], "image_path": row["image_path"]})
    new = {**item, "id": uuid.uuid4().hex, "image_path": image_path, "created_at": time.time()}
    with _lock:
        db = _load()
        db["items"].setdefault(uid, []).insert(0, new)
        _save(db)
    return _hydrate(dict(new))


def update_item(uid: str, item_id: str, patch: dict) -> None:
    patch = {k: v for k, v in patch.items() if k not in ("id", "image_url", "image_path")}
    if config.USE_SUPABASE:
        rows = sb().table("closet_items").select("data").eq("id", item_id).eq("user_id", uid).execute().data
        if rows:
            sb().table("closet_items").update({"data": {**rows[0]["data"], **patch}}) \
                .eq("id", item_id).eq("user_id", uid).execute()
        return
    with _lock:
        db = _load()
        for it in db["items"].get(uid, []):
            if it["id"] == item_id:
                it.update(patch)
        _save(db)


def delete_item(uid: str, item_id: str) -> None:
    if config.USE_SUPABASE:
        rows = sb().table("closet_items").select("image_path").eq("id", item_id).eq("user_id", uid).execute().data
        if rows and rows[0]["image_path"] and not rows[0]["image_path"].startswith("http"):
            sb().storage.from_(BUCKET).remove([rows[0]["image_path"]])
        sb().table("closet_items").delete().eq("id", item_id).eq("user_id", uid).execute()
        return
    with _lock:
        db = _load()
        db["items"][uid] = [i for i in db["items"].get(uid, []) if i["id"] != item_id]
        _save(db)


def add_order(uid: str, order: dict) -> dict:
    if config.USE_SUPABASE:
        row = sb().table("orders").insert({"user_id": uid, "data": order}).execute().data[0]
        return {**row["data"], "id": row["id"]}
    order = {**order, "id": uuid.uuid4().hex}
    with _lock:
        db = _load()
        db["orders"].setdefault(uid, []).insert(0, order)
        _save(db)
    return order


def list_orders(uid: str) -> list[dict]:
    if config.USE_SUPABASE:
        rows = sb().table("orders").select("*").eq("user_id", uid).order("created_at", desc=True).execute().data
        return [{**r["data"], "id": r["id"]} for r in rows]
    return _load()["orders"].get(uid, [])


# ---------------------------------------------------------------- bargain market price reports (souq)
# Shared across users (that's the point: what other people paid at a shop), so they're keyed by
# shop rather than by user. Each row: {id, user_id, data, image_path}.


def souq_reports(shop_id: str) -> list[dict]:
    if config.USE_SUPABASE:
        return (sb().table("souq_reports").select("id,user_id,data,image_path").eq("shop_id", shop_id)
                .order("created_at", desc=True).limit(500).execute().data)
    rows = [r for r in _load().get("souq_reports", []) if r["data"].get("shop", {}).get("id") == shop_id]
    return sorted(rows, key=lambda r: r["data"].get("created_at", ""), reverse=True)[:500]


def souq_reports_recent(limit: int = 3000) -> list[dict]:
    """The newest reports across every shop, for "what did people pay for this near me?"."""
    if config.USE_SUPABASE:
        return (sb().table("souq_reports").select("id,user_id,data,image_path")
                .order("created_at", desc=True).limit(limit).execute().data)
    rows = _load().get("souq_reports", [])
    return sorted(rows, key=lambda r: r["data"].get("created_at", ""), reverse=True)[:limit]


def souq_add_report(uid: str, data: dict, image: bytes | None = None) -> dict:
    sid = data.get("submission_id")
    if config.USE_SUPABASE:
        # Same submission sent twice (double tap, retry) -> return the first one.
        existing = (sb().table("souq_reports").select("id,user_id,data,image_path")
                    .eq("user_id", uid).eq("submission_id", sid).execute().data)
        if existing:
            return existing[0]
        path = _upload(uid, image, "jpg", "image/jpeg") if image else None
        return sb().table("souq_reports").insert({
            "user_id": uid, "shop_id": data["shop"]["id"], "submission_id": sid, "data": data, "image_path": path,
        }).execute().data[0]
    with _lock:
        db = _load()
        rows = db.setdefault("souq_reports", [])
        for r in rows:
            if r["user_id"] == uid and r["data"].get("submission_id") == sid:
                return r
        path = _local_upload(uid, image, "jpg") if image else None
        row = {"id": str(uuid.uuid4()), "user_id": uid, "data": data, "image_path": path}
        rows.append(row)
        _save(db)
    return row


def souq_delete_report(uid: str, report_id: str) -> None:
    """Only the person who shared a report can remove it."""
    if config.USE_SUPABASE:
        rows = sb().table("souq_reports").select("image_path").eq("id", report_id).eq("user_id", uid).execute().data
        if rows and rows[0].get("image_path"):
            sb().storage.from_(BUCKET).remove([rows[0]["image_path"]])
        sb().table("souq_reports").delete().eq("id", report_id).eq("user_id", uid).execute()
        return
    with _lock:
        db = _load()
        db["souq_reports"] = [r for r in db.get("souq_reports", []) if not (r["id"] == report_id and r["user_id"] == uid)]
        _save(db)


# ---------------------------------------------------------------- lazy mode (morning outfit texts)
# One subscription per user: phone, place, calendar link, send time. The calendar link is a
# secret, so it never leaves the server (see lazy.public_sub).


def lazy_get(uid: str) -> dict | None:
    if config.USE_SUPABASE:
        rows = sb().table("lazy_subscriptions").select("data").eq("user_id", uid).execute().data
        return rows[0]["data"] if rows else None
    return _load().get("lazy", {}).get(uid)


def lazy_save(uid: str, data: dict) -> dict:
    if config.USE_SUPABASE:
        sb().table("lazy_subscriptions").upsert({"user_id": uid, "data": data}).execute()
        return data
    with _lock:
        db = _load()
        db.setdefault("lazy", {})[uid] = data
        _save(db)
    return data


def lazy_delete(uid: str) -> None:
    if config.USE_SUPABASE:
        sb().table("lazy_subscriptions").delete().eq("user_id", uid).execute()
        return
    with _lock:
        db = _load()
        db.get("lazy", {}).pop(uid, None)
        _save(db)


def lazy_all() -> list[tuple[str, dict]]:
    if config.USE_SUPABASE:
        return [(r["user_id"], r["data"]) for r in sb().table("lazy_subscriptions").select("user_id,data").execute().data]
    return list(_load().get("lazy", {}).items())


def lazy_log(uid: str, entry: dict) -> None:
    """Every text we send (or would have sent, without Twilio), newest first, last 30 per user."""
    if config.USE_SUPABASE:
        current = lazy_get(uid) or {}
        current["outbox"] = ([entry] + current.get("outbox", []))[:30]
        lazy_save(uid, current)
        return
    with _lock:
        db = _load()
        sub = db.setdefault("lazy", {}).get(uid)
        if sub is not None:
            sub["outbox"] = ([entry] + sub.get("outbox", []))[:30]
            _save(db)


def delete_everything(uid: str) -> None:
    """'Forget me': wipes profile, closet, orders, price reports and photos."""
    if config.USE_SUPABASE:
        paths = [i["image_path"] for i in list_items(uid) if i.get("image_path") and not i["image_path"].startswith("http")]
        mirror = get_profile(uid).get("mirror_path")
        if mirror:
            paths.append(mirror)
        paths += [r["image_path"] for r in sb().table("souq_reports").select("image_path").eq("user_id", uid).execute().data
                  if r.get("image_path")]
        if paths:
            sb().storage.from_(BUCKET).remove(paths)
        for table, col in (("closet_items", "user_id"), ("orders", "user_id"), ("souq_reports", "user_id"),
                           ("lazy_subscriptions", "user_id"), ("profiles", "id")):
            sb().table(table).delete().eq(col, uid).execute()
        return
    import shutil

    with _lock:
        db = _load()
        for key in ("profiles", "items", "orders"):
            db[key].pop(uid, None)
        db["souq_reports"] = [r for r in db.get("souq_reports", []) if r["user_id"] != uid]
        db.get("lazy", {}).pop(uid, None)
        _save(db)
    shutil.rmtree(config.UPLOAD_DIR / uid, ignore_errors=True)
