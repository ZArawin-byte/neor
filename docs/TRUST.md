# NEor: trust, privacy and safety

NEor handles personal things: closet photos, a full-length mirror photo, optional body measurements, faith-related dress preferences, a monthly budget, and purchases. This page lists what we store, who can see it, and the safeguards in the code, so an auditor can check each claim against the code.

Each claim names where it's enforced. The **AI-lane** items are being built on the `be/ai` branch and are marked *(AI lane, in progress)* until it merges.

## What we store, and where

| Data | Where | Who can read it |
|---|---|---|
| Profile: style, colours, modesty and dress rules, optional measurements, budget, consent | Supabase `profiles.data` | Only the signed-in user |
| Closet items: name, category, colours, material, price, wear count, laundry flag | Supabase `closet_items` | Only the owner |
| Closet and mirror photos | Supabase Storage, **private** bucket `closet` | Only the owner, through signed links that expire after 1 hour |
| Bag entries, saved boards, saved looks | Supabase `bag`, `boards`, `looks` | Only the owner |
| Orders | Supabase `orders`: items, total, `payment_mode: "simulated"`, card network, last 4 digits, a simulated token | Only the owner |

Demo mode (no Supabase keys) keeps the same data in a local file, `data/local_db.json`, for one demo user. It's for local demos only, never deployment.

**What we never store:** full card numbers, CVCs, expiry dates, passwords (Google sign-in is handled by Supabase), or photo metadata (EXIF and GPS are stripped).

## Who can see what

- **Sign-in:** Google, through Supabase Auth. The API checks the user's token on every request (`app/deps.py`).
- **Every query is filtered by the verified user id** (`app/store.py`). Asking for someone else's item, bag entry, board or look returns **404**, so an id can't even be confirmed to exist. Tests: `tests/test_core.py`, `test_commerce.py` and `test_saved.py`, the `*other_user*` cases.
- **Row-level security** is on for every table (`supabase/migrations/*.sql`), so even if the public anon key leaked, a user could only reach their own rows. The server uses the service-role key, which never leaves the server; `/api/config` hands out only the public anon key.

## Photos

- **Real images only.** Pillow has to open the file, so a renamed file is refused with 415. JPEG, PNG and WebP only, 8 MB max (`app/uploads.py`).
- **Metadata stripped.** Every upload is re-saved without EXIF, which removes GPS location and camera details. This matters most for mirror photos, which are often taken at home. Test: `test_gps_exif_is_stripped_from_mirror_photo`.
- **Private storage.** Photos live in a private bucket, file names are random server-made ids, and links expire after an hour.

## Payments: simulated, Visa-only, and labelled

The organisers confirmed no Visa API is required, so **no money ever moves**. To stay honest about it (`app/payments.py`):
- **Only published Visa test card numbers are accepted** (e.g. 4242 4242 4242 4242). Other networks' test cards get "NEor accepts Visa only". Any other number, including a real card, is refused, so a real card number goes nowhere.
- **Every order says so:** it's marked `payment_mode: "simulated"` with the note "no money moved and no real order was placed". The checkout page says it before you type anything.
- **Card details are never logged or stored.** Only the network, the last 4 digits and a simulated token are kept. Test: `test_card_number_never_reaches_the_logs`.
- **No double charges.** An `Idempotency-Key` header means a double-click or retry returns the first order instead of making a second.
- **Budget guard.** If a purchase would go over the user's monthly budget, the API answers 409 and only continues after the user explicitly confirms.

## The AI can't spend money or invent things

- **The AI can't buy anything.** No AI route creates orders. Checkout only runs when the user submits the checkout form.
- **The AI only recommends what exists.** Recommended closet items, catalog products and places are filtered to ids we gave it; anything else is dropped (`app/ai.py`).
- **Every answer is labelled.** Each AI response says whether Groq or the rule-based fallback answered (`ai` field). The fallback means every feature still works with no AI at all.
- **Ideas aren't products.** In the bag, an entry is a "product" only if it's in the catalog; otherwise the API labels it an "idea", and the page says there's nothing to buy yet.
- **The catalog is a labelled sample** with fictional brands. We don't show real listings, prices or stock.
- *(AI lane, in progress)*
  - **Data minimization:** only the fields a task needs go to the AI. Never the name, age, gender, pronouns or tradition. Measurements only for fit questions, and only with consent.
  - **Consent:** if `ai_consent` is off, every AI feature uses rules.
  - **Laundry:** items in the laundry basket are never sent to the AI.
  - **Validated output:** every AI answer is checked against a strict schema.
  - **Computed numbers:** every number shown is calculated, not guessed by the AI.

## Abuse limits

- **Rate limits:** 20 requests a minute per user on AI, photo-tagging, care-label and link-import routes, and 5 a minute on checkout (`app/rate_limit.py`). The 429 response still carries CORS headers, so the app can show the message.
- **Input limits:** strings are capped at 200 characters (1,000 for notes) and lists at 20 entries. Unknown fields are dropped. Boards and looks take at most 40 pieces and refuse embedded image data (`app/schemas.py`).
- **Link import** (`app/importer.py`):
  - only public internet hosts are fetched, and every redirect is checked again, so a pasted link can't reach our own network;
  - pages and photos are streamed with a hard size cap;
  - we read only the one page the user pasted, and never crawl or scrape search results.

## Your control

- **Everything personal is optional.** Every profile field can be left empty or cleared.
- **The laundry basket** keeps an item out of every suggestion.
- **"Forget me"** (`DELETE /api/me`) deletes the profile, closet, photos, orders, bag, boards and looks, and then the sign-in account itself.

## Known limits

- The rate limiter keeps its state in memory, so it resets on restart and covers only a single server.
- The public-host check resolves DNS before connecting, and the HTTP client resolves again when it connects. A fast DNS rebinding attack could slip between the two. We'd pin the resolved IP before any real launch.
- Signed photo links saved inside a board or look stop working after an hour; the photos still load from the closet.
- The background-removal model that runs in the browser is AGPL-licensed (see `frontend/FRONTEND_SPEC.md` §10).
