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
        "demo_email": config.DEMO_EMAIL or None,
    }


@router.get("/api/health")
def health_details():
    """Which services are configured. Booleans only: never echoes a key or URL."""
    return {"ok": True, "supabase": config.USE_SUPABASE, "groq": config.USE_GROQ,
            "perceptron": bool(getattr(config, "USE_PERCEPTRON", False))}
