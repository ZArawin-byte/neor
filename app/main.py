"""App wiring only. Feature code lives in app/routers/; add new routers below."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config
from .routers import ai_routes, commerce, items, meta, profile

app = FastAPI(title="Neor API", description="Backend for Neor - step into your closet.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.FRONTEND_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
if not config.USE_SUPABASE:
    app.mount("/uploads", StaticFiles(directory=config.UPLOAD_DIR), name="uploads")

# --- core lane routers ---
app.include_router(meta.router)
app.include_router(profile.router)
app.include_router(items.router)
app.include_router(commerce.router)

# --- AI lane routers ---
app.include_router(ai_routes.router)
