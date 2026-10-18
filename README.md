# NEor: step into your closet

An AI stylist that dresses you from the clothes you already own, then walks you from a real gap in your wardrobe to a Visa-only checkout that respects your budget. Built for DubHacks 2026, in Visa's "Reimagine Shopping" track.

- **Backend:** FastAPI (`app/`). Supabase for Google sign-in, Postgres and private photo storage, or a local JSON file in demo mode.
- **AI:** Groq, with a rule-based fallback for every feature.
- **Frontend:** React + Vite (`frontend/`). See [frontend/FRONTEND_SPEC.md](frontend/FRONTEND_SPEC.md).
- **Trust and privacy:** [docs/TRUST.md](docs/TRUST.md). **Team rules:** [CLAUDE.md](CLAUDE.md).

## Run it

```bash
uv venv .venv --python 3.12 && uv pip install -r requirements-dev.txt   # or: python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env                                                     # leave it blank for demo mode
.venv/bin/uvicorn app.main:app --reload --port 8000                      # API docs at http://localhost:8000/docs
cd frontend && npm install && npm run dev                                # http://localhost:5173 (proxies /api to :8000)
```

**Demo mode:** with no keys at all, everything runs.
- One local demo user, with data in `data/local_db.json`.
- Every AI feature answers from the rule-based fallback, labelled `"ai": "rules"`.
- To fill the demo closet, bag, boards and looks: `.venv/bin/python -m scripts.seed_demo`. Start over with `python -m scripts.reset_demo`.

## Test

```bash
.venv/bin/pytest -q && .venv/bin/ruff check app tests scripts
cd frontend && npm run build        # type-checks the frontend
```

Tests run in demo mode with no keys and no network: Groq and httpx are mocked, and every test gets a throwaway store.

## Environment variables

| Variable | Needed for | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Google sign-in, database | The anon key is public by design; `/api/config` hands it to the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Database, storage | **Server only.** Never put it in the frontend |
| `GROQ_API_KEY` | Real AI answers | Blank means the rule-based fallback |
| `GROQ_TEXT_MODEL`, `GROQ_FAST_MODEL`, `GROQ_VISION_MODEL` | Model choice | Defaults: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b` |
| `PERCEPTRON_API_KEY`, `PERCEPTRON_MODEL` | Care-label OCR | Optional. Without it, the AI lane falls back to Groq vision |
| `FRONTEND_ORIGINS` | CORS | Comma-separated, e.g. `https://neor-closet.web.app,http://localhost:5173` |
| `DEMO_EMAIL`, `DEMO_PASSWORD` | `scripts/seed_demo.py` | The demo account holds only fictional data and can be reset |
| `VITE_API_URL` (frontend) | Deployed frontend | The API's URL when the frontend and API are on different hosts |

## Supabase setup (once)

1. Create a project. In the SQL Editor, run `supabase/migrations/001_init.sql`, then `002_saved.sql`, then `003_bag.sql`.
2. Go to **Authentication → Providers → Google** and turn it on, using a Google OAuth client ID and secret.
3. Under **Authentication → URL configuration**, add `https://neor-closet.web.app/?entering=1` and `http://localhost:5173/?entering=1` as redirect URLs.
4. Put the URL and both keys in `.env`, and in Render's environment.

## Deploy

- **API:** Render, using `render.yaml` (Dashboard → New → Blueprint). The free tier sleeps when idle, so open `/api/health` a minute before you demo.
- **Frontend:** `cd frontend && VITE_API_URL=https://<your-api>.onrender.com npm run build && firebase deploy`. That deploys to `neor-closet.web.app`.

## What's real and what's simulated

| Real | Simulated, and labelled as such |
|---|---|
| Your closet, photos, profile, boards, looks and bag, stored per user | **Checkout:** only Visa *test* cards work, no money moves, every order says `payment_mode: "simulated"` |
| AI outfits, critique, shopping chat and care guide from your actual closet (Groq) | **Catalog:** 30 sample products from fictional brands |
| Places from OpenStreetMap; product facts read from a link you paste | |

## API reference

Every route except `/`, `/api/health`, `/api/config` and `/api/catalog` needs `Authorization: Bearer <Supabase access token>`. Demo mode needs no token. Errors look like `{"detail": "Plain-English message"}`.

| Method | Path | Body or params | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ok, supabase, groq, perceptron}`, booleans only |
| GET | `/api/config` | | `{supabase_url, supabase_anon_key, demo, ai, demo_email}` |
| GET | `/api/profile` | | Profile object, plus `mirror_url` and `points` |
| PUT | `/api/profile` | Any profile fields; only the fields sent change | The updated profile. 422 if a colour is both loved and avoided |
| POST | `/api/profile/mirror` | multipart `file` | The profile, with a new `mirror_url` |
| DELETE | `/api/me` | | `{ok}`. Deletes everything, including the sign-in account |
| GET | `/api/items` | | **A plain array** of items |
| POST | `/api/items` | multipart `meta` (JSON) + optional `file` | The new item. 422 on bad JSON or an unknown category |
| PATCH | `/api/items/{id}` | Item fields, e.g. `{"laundry": true}` | `{ok}`. 404 if it isn't yours |
| DELETE | `/api/items/{id}` | | `{ok}`. 404 if it isn't yours |
| POST | `/api/items/{id}/worn` | | `{ok, wear_count}` |
| POST | `/api/items/starter` | | The 8 starter pieces. Calling it again returns them rather than adding duplicates |
| POST | `/api/items/import` | `{"url": "https://shop…/product"}` | `{title, price, currency, brand, material, color, structured, source, image}`, where `image` is a data URL |
| POST | `/api/items/analyze` | multipart `file` | Suggested tags (AI lane) |
| GET | `/api/catalog` | | 30 sample products |
| GET | `/api/bag` | `?status=wanted&priority=high` | Entries, each with `kind: "product"\|"idea"` and `product` |
| POST | `/api/bag` | `{catalog_id?, title?, reason, source, source_ref?, priority}` | The entry. The same product twice returns the existing entry |
| PATCH | `/api/bag/{id}` | `{priority?, status?, title?, reason?}` | The entry |
| DELETE | `/api/bag/{id}` | | `{ok}` |
| POST | `/api/checkout` | `{bag_ids?, product_ids?, card: {number, exp, cvc, name}, confirm_over_budget?}` + optional `Idempotency-Key` header | The order. 402 if the card isn't a Visa test card, 409 if over budget |
| GET | `/api/orders` | | `{orders, budget, spent_this_month, points, cost_per_wear}` |
| GET / POST | `/api/boards` | `{id?, name, pieces[]}` | Boards. Posting an existing id replaces that board |
| DELETE | `/api/boards/{id}` | | `{ok}` |
| GET / POST | `/api/looks` | `{id?, name, pieces[], photo?, tryon?, verdict, harmony, occasion?}` | Looks |
| PATCH / DELETE | `/api/looks/{id}` | `{favorite}` | The look, or `{ok}` |
| POST | `/api/ai/outfit`, `/api/ai/weak-spots`, `/api/ai/shop`, `/api/ai/care`, `/api/ai/places` | See `/docs` | AI lane; every answer includes `ai: "groq"\|"rules"` |

Rate limits: 20 per minute per user on the `/api/ai/*`, analyze, care-label and import routes, and 5 per minute on checkout. Over the limit, you get a 429 with a `Retry-After` header.

Example checkout:

```bash
curl -X POST localhost:8000/api/checkout -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' \
  -d '{"product_ids": ["p18"], "card": {"number": "4242 4242 4242 4242", "exp": "12/30", "cvc": "123", "name": "Demo"}}'
```
