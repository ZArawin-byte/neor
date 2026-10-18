"""App wiring only. Feature code lives in app/routers/; add new routers below."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config, lazy, souq
from .deps import current_user
from .rate_limit import RateLimitMiddleware
from .routers import ai_routes, bag, commerce, items, meta, profile, saved
from .uploads import read_image

app = FastAPI(title="neor API", description="Backend for neor - step into your closet.")
# --- core lane middleware. Rate limits sit inside CORS so a 429 still reaches the browser readable.
app.add_middleware(RateLimitMiddleware)
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
app.include_router(bag.router)
app.include_router(saved.router)

# --- AI lane routers ---
app.include_router(ai_routes.router)

# --- bargain market + lazy mode (Anna). souq: photo ID, offers, shops, shared price ledger.
# lazy: morning outfit texts from weather + calendar; its scheduler runs inside this process.
app.include_router(souq.router(current_user, read_image))
app.include_router(lazy.router(current_user))
lazy.start(app)
