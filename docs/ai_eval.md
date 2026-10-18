# neor AI eval

Measured 2026-10-18 00:49 PDT by `scripts/ai_eval.py`: 10 fixed requests on the 8-piece starter closet, against real Groq (`openai/gpt-oss-120b` text, `openai/gpt-oss-20b` fast, `qwen/qwen3.8-27b` vision), free tier, 7s between requests. These are the numbers from that run, not targets.

| Metric | Result |
|---|---|
| Schema-valid rate | 100% (10/10) |
| Invented-id rate | 0% (0/41 ids) |
| Fallback rate | 0% (0/10) |
| Latency p50 | 1154 ms |
| Latency p95 | 2740 ms |

- **Schema-valid**: the response parses into the Pydantic model that mirrors `frontend/src/lib/types.ts`.
- **Invented id**: any closet or catalog id in the response that the model was never given. Must be 0.
- **Fallback**: the answer came from the rule-based path instead of Groq (still valid, labelled `ai: rules`).
- **Latency**: wall time per request, including real weather lookups where a place is named.

| Request | Feature | Engine | Valid | Invented ids | Latency | Note |
|---|---|---|---|---|---|---|
| University day | outfit | groq | yes | 0 | 1254 ms |  |
| Modest wedding | outfit | groq | yes | 0 | 1319 ms |  |
| Seattle, live weather | outfit | groq | yes | 0 | 2135 ms | clear |
| Gym session | outfit | groq | yes | 0 | 1054 ms |  |
| Cafe date | outfit | groq | yes | 0 | 2740 ms | clear |
| Travel to Dubai | outfit | groq | yes | 0 | 2509 ms | clear |
| Winter birthday | outfit | groq | yes | 0 | 1041 ms |  |
| Shop: wedding shoes | shop | groq | yes | 0 | 929 ms |  |
| Lion critique | weak_spots | groq | yes | 0 | 576 ms |  |
| Care: wool coat | care | groq | yes | 0 | 483 ms |  |
