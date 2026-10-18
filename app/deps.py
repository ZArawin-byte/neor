"""Shared request dependencies. current_user verifies the Supabase token (or returns the demo user)."""
import time

from fastapi import Header, HTTPException

from . import config, store


_token_cache: dict[str, tuple[str, float]] = {}


def current_user(authorization: str = Header(default="")) -> str:
    if not config.USE_SUPABASE:
        return config.DEMO_USER_ID
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "Sign in first")
    cached = _token_cache.get(token)
    if cached and cached[1] > time.time():
        return cached[0]
    uid = store.user_id_from_token(token)
    if not uid:
        raise HTTPException(401, "Session expired")
    _token_cache[token] = (uid, time.time() + 300)
    return uid
