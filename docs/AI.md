# How neor's AI works

neor's AI is a stylist that is only allowed to choose from things we can check. Python does the counting, scoring and filtering. The language model picks from a short list and writes the words. Anything it says that we can't verify is thrown away.

## Which models, and why

| Job | Provider and model | Why this one |
|---|---|---|
| Outfits, shopping chat | Groq, `openai/gpt-oss-120b` | The strongest model on Groq that supports strict JSON schemas. Fast enough to feel instant. |
| Critique wording, care wording, place picks | Groq, `openai/gpt-oss-20b` | Small jobs: rewording facts we already computed. Also the backup when the big model hits its rate limit. |
| Tagging a clothing photo, reading a care label | Groq, `qwen/qwen3.8-27b` (vision) | Reads images. A preview model, so every reply is validated and has a fallback. |
| Reading a care label (first choice) | Perceptron, `perceptron-mk1.5` OCR | Purpose-built text reading from photos. Used when `PERCEPTRON_API_KEY` is set. |
| Weather | Open-Meteo | Free, no key, real forecasts. |
| Places | OpenStreetMap (Nominatim and Overpass) | Free, real places. Cafes, parks, viewpoints and thrift shops. |

All model ids live in `app/config.py` and can be changed in `.env`.

## What data goes where

| Sent to | What | Never sent |
|---|---|---|
| Groq | Your style words, loved and avoided colours, modesty level and dress rules, climate, a budget *band* (e.g. "$100-300/month"), and the names, colours and tags of closet pieces that aren't in the laundry basket. Photos only when you tag an item or read a label. | Your name, age, gender, pronouns, tradition, email, exact budget, order history, card details, mirror photo. |
| Groq (only for fit questions) | Your measurements, but only if `ai_consent` is on **and** your message is about fit or size. | Measurements in any other request. |
| Perceptron | The care-label photo you chose to read. | Anything else. |
| Open-Meteo, OpenStreetMap | A place or city name you typed. | Anything about you. |

**What never leaves our server:** your profile identity fields, the closet's real item ids (the model sees aliases like `i3`), laundry items, order and payment data, and logs. Logs record only the feature, model, engine, latency and error type. They never record prompts, closet contents, photos or tokens.

**Turning AI off:** set `ai_consent` to false in your profile. Every feature then answers with rules and sends nothing to any model provider. Responses say `fallback_reason: "consent_off"`.

## Grounding: retrieve first, then generate

1. **Outfits.** `app/stylist.py` scores every piece: occasion match, style overlap, season, real weather, colours you love or avoid, and favourite looks. It then runs a beam search over outfit templates (top + bottom + shoes, or dress + shoes, plus a layer when it's cold or wet, plus one accessory). Colour harmony uses the same OKLCH maths as the frontend (`harmony_of`, a port of `color.ts`). The model gets only the top 12 pieces per slot and the 3 best complete outfits, under aliases. It picks or refines one and writes the title, the why and the styling tip. Any alias it invents is dropped.
2. **Weather.** Named places are looked up on Open-Meteo first. The real temperature, rain chance and wind go into the scoring and the prompt, and come back in the response as `weather`.
3. **Shopping.** Python shortlists the catalog: modesty, budget left, the words you used, your styles. It also works out "you already own something similar" (same category and colour family) and gives that to the model as a fact.
4. **The lion's critique.** `app/insights.py` counts how many complete outfits the closet can make for each occasion and each season of your climate. It also counts empty categories and neutrals against accents. `unlocks` is the real number of extra outfits a suggested piece makes possible, and the score is the share of occasions and seasons covered. The model may reword the summary and reasons, but any number it writes must already be in the facts.
5. **Care.** Your care label comes first. A regex reads fibres and care symbols, and the model fills only what the regex missed. Then comes `app/context/care_kb.py`, a hand-written fabric knowledge base. The model only rewords. The steps themselves come from the label and the knowledge base.
6. **Places.** Real OpenStreetMap spots are sorted the same way every time and cached for an hour. The model picks 4 and can only use ids it was given.

## Validation

- Every model call uses Groq structured outputs (`json_schema`, strict) and is validated with Pydantic (`app/ai_schemas.py`). The vision model runs in non-strict mode, because it loops in strict mode on images, but its reply is still validated.
- If validation fails, the model gets one retry with the error. If that fails too, the request answers with rules.
- Ids are checked against what we sent: closet aliases, catalog ids, place ids.
- Free text is capped at 200 characters, and chat history at 8 turns.

## Fallbacks

Every feature has a rule-based answer, so the app works with no keys, no network or no consent. Responses always say which engine answered (`ai: "groq" | "rules" | "perceptron" | "offline"`), and a fallback says why:

| `fallback_reason` | Meaning |
|---|---|
| `no_key` | No `GROQ_API_KEY` configured. |
| `consent_off` | The user turned AI off. |
| `provider_error` | Groq was down, timed out, or rate-limited even on the backup model. |
| `invalid_output` | The model's reply failed validation twice. |

## Measured quality

See [`docs/ai_eval.md`](ai_eval.md): 10 fixed requests, with the real numbers from the last run. `scripts/ai_smoke.py` runs every feature once as a quick live check.

## Known limits

- **Free-tier rate limits.** Groq allows 8,000 tokens a minute on `gpt-oss-120b` and 1,000 output tokens a minute on the vision model. Heavy use falls back to the fast model, and then to rules. The vision model handles about two photos a minute.
- **Photo tags are guesses.** Material from a photo is always worded as a guess ("likely wool blend"), and the quality tier for your own items is marked `tier_basis: "estimate from material"`.
- **Care-label reading** depends on a sharp photo. Perceptron needs account quota, and without it reading falls back to Groq vision.
- **OpenStreetMap mirrors are flaky.** When all three Overpass servers are busy, places returns no picks with a `reason` instead of guessing.
- **The catalog is a fictional demo catalog** of 30 products. Prices and tiers are demo data, not live stock.
- **Outfit scoring is heuristic.** The weights are hand-set, not learned. They are deterministic and explainable, but not personalised beyond your profile and favourite looks.
- **Body-aware fit advice** is limited to sizes you entered, and only with consent. The app never comments on bodies.
