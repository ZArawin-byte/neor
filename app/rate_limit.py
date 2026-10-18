"""Per-user rate limits on the expensive or sensitive routes, matched by URL path.

Matching by path means AI-lane routes get covered without anyone editing their router, and new
paths (like /api/items/care-label) are limited the moment they exist. The key is a hash of the
sign-in token, or the client IP when there is none. State is in memory, which is fine for one
server instance at a hackathon.
"""
import hashlib
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

WINDOW_SECONDS = 60
# (path, per-minute limit, prefix match?)
RULES = [
    ("/api/checkout", 5, False),
    ("/api/ai/", 20, True),
    ("/api/items/analyze", 20, False),
    ("/api/items/care-label", 20, False),
    ("/api/items/import", 20, False),
]

_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)


def _rule_for(path: str):
    for rule_path, limit, prefix in RULES:
        if path == rule_path or (prefix and path.startswith(rule_path)):
            return rule_path, limit
    return None


def _who(request: Request) -> str:
    token = request.headers.get("authorization", "")
    if token:
        return "t:" + hashlib.sha256(token.encode()).hexdigest()[:16]
    return "ip:" + (request.client.host if request.client else "unknown")


def reset() -> None:
    _hits.clear()


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rule = _rule_for(request.url.path) if request.method != "OPTIONS" else None
        if rule:
            rule_path, limit = rule
            now = time.monotonic()
            if len(_hits) > 10_000:  # keep memory bounded if someone sprays IPs
                _hits.clear()
            q = _hits[(rule_path, _who(request))]
            while q and now - q[0] > WINDOW_SECONDS:
                q.popleft()
            if len(q) >= limit:
                wait = int(WINDOW_SECONDS - (now - q[0])) + 1
                return JSONResponse(
                    {"detail": f"Slow down a little: try again in {wait} seconds."},
                    status_code=429, headers={"Retry-After": str(wait)},
                )
            q.append(now)
        return await call_next(request)
