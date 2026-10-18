"""Health check and public config. Owner: core lane."""
from fastapi import APIRouter

from .. import config

router = APIRouter()


@router.get("/")
def health():
    return {"app": "neor", "ok": True, "docs": "/docs"}


@router.get("/api/config")
def public_config():
    # Anon key is designed to be public; the service-role key never leaves the server.
    return {
        "supabase_url": config.SUPABASE_URL if config.USE_SUPABASE else None,
        "supabase_anon_key": config.SUPABASE_ANON_KEY if config.USE_SUPABASE else None,
        "demo": not config.USE_SUPABASE,
        "ai": "groq" if config.USE_GROQ else "offline",
    }
