# NEor: team rules for every Claude Code session

NEor is an AI wardrobe and styling app for DubHacks 2026, entered in Visa's "Reimagine Shopping" track. **Submissions are due Sun 18 Oct 2026 at 10:30 AM PT.** Prefer working and honest over clever.

- Backend: FastAPI in `app/`. Data goes to Supabase when its keys are set, otherwise to a local JSON file (demo mode, no keys needed).
- Frontend: React and Vite in `frontend/`. It's already built; see `frontend/FRONTEND_SPEC.md`.
- AI: Groq (`app/ai.py`), with a rule-based fallback for every feature. Optional Perceptron OCR for care labels.

## Run and test

```bash
uv venv .venv --python 3.12 && uv pip install -r requirements-dev.txt   # or python -m venv + pip
.venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev                               # http://localhost:5173
.venv/bin/pytest -q && .venv/bin/ruff check app tests
```

Tests run in demo mode through the `client` fixture in `tests/conftest.py`. Never call the network in tests: mock Groq, Perceptron and httpx.

## The frontend contract is frozen

The frontend reads the response shapes in `frontend/src/lib/types.ts` and `frontend/src/lib/api.ts`.
- **Additive changes only.** You may add fields and add routes. Never rename or remove fields, change types, or turn a list into an object. `GET /api/items` must keep returning a plain array.
- Every AI response keeps its `ai` field (`"groq"`, `"rules"`, `"perceptron"`…) so the UI can show which engine answered.
- Item data may hold frontend fields: `rack`, `laundry`, `starter`, `status`, `hex`, `favorite`. Validation must keep them.
- New frontend code goes in its own folder under `frontend/src/features/<name>/`, registered in `src/features/index.ts`. Call the API through the exported `call` and `json` helpers in `lib/api.ts`.

## File ownership (so two branches don't collide)

| Lane | Person | Owns |
|---|---|---|
| AI | Zahra (`be/ai`) | `app/ai.py`, `app/ai_schemas.py`, `app/stylist.py`, `app/insights.py`, `app/context/*` (weather, places, care knowledge), `app/vision.py`, `app/routers/ai_routes.py`, `tests/test_ai*.py`, `scripts/ai_*.py`, `docs/AI.md`, `frontend/src/features/care-label/` |
| Core | Yarexzi (`be/core`) | `app/store.py`, `app/schemas.py`, `app/uploads.py`, `app/budget.py`, `app/payments.py`, `app/importer.py`, `app/routers/{meta,profile,items,commerce,saved}.py`, `supabase/`, `scripts/seed_demo.py`, `render.yaml`, `README.md`, `docs/TRUST.md`, `tests/test_core*.py`, `frontend/src/lib/saved.ts`, `frontend/src/features/bag/` |

Shared files: edit only your own marked section, and keep the change small.
- `app/main.py`: only the `include_router` lines under your lane's comment. The core lane may also add app-wide middleware there, such as rate limits matched by URL path, but never by editing AI-lane routers.
- `app/config.py`, `.env.example`, `requirements.txt`: add lines only under your lane's section.
- `frontend/src/features/index.ts`: one line per feature.

If you need a function from the other lane's file, call it if it exists. If it doesn't, write a small local helper and leave a `# TODO(other lane)` comment instead of editing their file.

## Trust rules (these are judged: Visa Trust 15%, plus the Veyzl audit)

- The AI may only reference IDs it was given (closet, catalog, places). Drop anything else, and validate every AI response with Pydantic.
- Never invent products, prices, statistics, reviews, stock levels or sustainability claims. A number shown to the user must be computed from data, or labelled as an estimate.
- Send the AI only what the task needs. Never send the name, age, gender, pronouns or tradition. Send `dress_rules` and `modesty` as constraints. Send measurements only for fit questions, and only when `ai_consent` is true. If `ai_consent` is false, use rules.
- Items with `laundry: true` never go into any AI prompt or suggestion.
- Checkout is **simulated**. Accept only Visa test card numbers, mark every order `payment_mode: "simulated"`, and never log card fields.
- Never log prompts, closet contents, photos or tokens.

## Git

- Base branch: `backend-dev`. Work on your lane branch (`be/ai` or `be/core`), created from `backend-dev`.
- Commit at the end of each milestone, push the branch, and keep one PR open into `backend-dev`. PRs are audited, so keep them readable.
- Never push to `main`, never force-push, and never rewrite the other lane's commits. Before your final push, run `git pull --rebase origin backend-dev`.
- Commit messages: `ai: …` or `core: …`, in the imperative mood.
