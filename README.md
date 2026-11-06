# cloudflare-llm-gateway

A serverless, **OpenAI-compatible LLM API gateway** for **Cloudflare Workers** — a
[new-api](https://github.com/QuantumNous/new-api) / [one-api](https://github.com/songquanpeng/one-api)
style gateway that runs entirely on the **free tier** (Workers + D1, no server, no Redis).

![cloudflare-llm-gateway — pool many AI keys behind one OpenAI-compatible API on Cloudflare](assets/hero.png)

Pool many upstream AI API keys behind one stable OpenAI-compatible endpoint.
Dead keys auto-disable, rate-limited keys cool down with progressive backoff and
auto-revive, requests fall back across providers so callers only see a 503 when
every provider with live keys has failed, and
you get a built-in admin/consumer console — all on the free tier.

## Features

- **16 providers, OpenAI-compatible** — Gemini, Mistral, OpenRouter, OpenAI, DeepSeek, Groq, Moonshot (Kimi), GLM (Zhipu), Qwen (DashScope), DeepInfra, Fireworks, Cerebras, AI21, Cohere, ElevenLabs, Stability. One `POST /v1/chat/completions` + `GET /v1/models`; route by model name or an explicit `provider:model` prefix. Native passthrough at `/gemini/*`, `/mistral/*`, `/openrouter/*`, `/elevenlabs/*`, `/stability/*` too.
- **`auto` model** — send `"model": "auto"` and the gateway picks the strongest tool-capable model among providers with live keys right now, in a fixed preference order (gpt-4o, deepseek-chat, qwen-max, …), preferring reasoning-capable models when you ask to think, and failing over to the next on error. Listed first in `/v1/models`; works on every protocol. The `X-KeyPool-Provider/Model` response headers say who served it.
- **Thinking on every protocol and provider** — `reasoning_effort` (OpenAI), `reasoning.effort` (Responses), `thinking` / `output_config.effort` (Anthropic) and `thinkingConfig` (Gemini) are folded into one effort level, rewritten per upstream (DeepSeek `reasoning_effort`, GLM `thinking.type`, OpenRouter `reasoning`, Gemini `thinkingConfig`, Qwen `enable_thinking`; dropped for providers that reject it), and the reasoning comes back in each protocol's own shape: `reasoning_content`, Anthropic `thinking` blocks, Responses `reasoning` items, Gemini `thought` parts. `/v1/models` flags thinking-capable models with `reasoning` + `supported_reasoning_levels`.
- **Four client protocols on one pool** — OpenAI Chat (`/v1/chat/completions`), OpenAI Responses (`/v1/responses`), Anthropic Messages (`/v1/messages`) and Gemini (`/v1beta/models/{model}:generateContent` / `:streamGenerateContent`). Each is translated onto the same pool, so any pooled model works from any client; `/v1/models` is readable by both OpenAI and Anthropic SDKs and `/v1beta/models` lists the same models in Gemini format.
- **Self-healing key pool** — keys are picked at random among the active ones for the provider; a bad-credential `401/403` disables a key, a `429`/quota error cools it down with **progressive backoff** (capped at 360 minutes for daily-limit errors), and a success revives it. A background sweep retries cooldowns and disabled keys, so the pool recovers without you touching it.
- **Honest liveness probes** — a probe is a real 1-token inference or a balance check (Gemini, DeepSeek, OpenRouter, Moonshot, GLM, Qwen, DeepInfra, AI21), because a bare `/models` call lies about suspended, throttled or broke accounts; providers whose `/models` is trustworthy (OpenAI, Mistral, Groq, Fireworks, Cerebras, Cohere) are probed that way. OpenRouter keys with 0 balance are probed with a real call to a free model instead of being written off. Model availability is probed the same way: models you added via a key are checked first (available ones confirmed, blocked ones re-checked so a revived model comes back), then the static catalog, capped at 24 calls per sweep.
- **Auto-fallback** — if the chosen provider fails with a `429` or a `5xx`, the request is transparently served by another provider with live keys (response carries `X-KeyPool-Provider/Model/Fallback`); other `4xx` errors are returned to the caller immediately, never retried on another provider. Opt out per request with `{"fallback": false}`. A 503 still means every provider with live keys failed (or the pool is empty).
- **Model list is fetched live, per key** — after entering a key, the console pulls that provider's current model list from upstream; `/v1/models` serves the static catalog plus any models you added that way, minus models a key was probed and found unable to serve. Each key row has a **新增模型** button: pick new models from the live upstream list and they become servable immediately.
- **Per-key console** — every key (masked) with status, stats, last error, and a live "检测全部" batch check (OpenRouter/DeepSeek show real balance); enable/disable/delete; disabled keys hidden by default; a per-key debug chat.
- **Roles + SSO** — optional OIDC SSO (Authorization Code + PKCE) with an admin-approval gate, or `ADMIN_TOKEN` + minted tokens. Admins manage the pool and aren't metered; consumers self-serve their own tokens. User tokens carry quota, RPM limit and expiry, all enforced server-side; `/me/*` accepts the same bearer tokens as the console session.
- **Metering & billing** — per-request + per-token usage with daily charts and logs; optional credit billing (per-model input/output pricing, a global discount, reserve-then-charge per request so a stream is only billed after it finishes) with Stripe top-up. Off by default. Stripe checkout accepts USD only, $0.50–$10,000 per top-up.
- **Built-in chat** — consumer chat playground (streaming) and an admin per-key debug chat.
- **$0 to run** — Cloudflare Workers + D1 free tier; unattended health-check via cron (every 5 minutes) or an included GitHub Actions schedule.

## Architecture

```
client ──▶ Worker (Hono) ──▶ pick an active key at random ──▶ upstream provider
                │                                            (Gemini/Mistral/OpenRouter/…)
                ├─ D1: keys, tokens, users, logs, prices, balances, model_status
                └─ cron every 5 min: health check, sweep cooldowns, probe models
```

Keys self-heal: a `429`/quota error cools a key down, a bad-credential `401`/`403`
disables it, and both come back on a successful retry or via the cron sweep.

![self-healing key pool: active → cooldown on 429, active → disabled on 401, both auto-revive back to active](assets/self-healing.png)

## Setup

```bash
npm install --legacy-peer-deps   # wrangler wants workers-types v5, the repo pins v4

# 1. create the D1 database, then paste its id into wrangler.toml
npx wrangler d1 create llm-gateway
cp wrangler.toml.example wrangler.toml      # edit database_id (+ optional SSO vars)

# 2. apply the schema
npx wrangler d1 execute llm-gateway --remote --file=./schema.sql

# 3. set secrets
npx wrangler secret put ADMIN_TOKEN         # bearer token for admin/API
npx wrangler secret put SESSION_SECRET      # random 32+ bytes (for SSO sessions)

# 4. deploy
npx wrangler deploy
```

Open the deployed URL to reach the admin console. `wrangler.toml.example`
documents every variable: `COOLDOWN_MINUTES` (default 15), `MAX_KEY_RETRIES`
(default 4), `PROBE_INTERVAL_MINUTES` (default 60), OIDC SSO, billing
(`BILLING_ENABLED`, `DISCOUNT`, `SIGNUP_BONUS_USD`), Stripe keys and
`PUBLIC_BASE_URL`.

## API

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /v1/chat/completions` | user token / session | OpenAI-compatible chat (incl. streaming) |
| `GET /v1/models`, `GET /v1/models/:id` | user token / session | list available models |
| `POST /v1/messages` | user token / session | Anthropic Messages |
| `POST /v1/responses` | user token / session | OpenAI Responses |
| `GET /v1beta/models`, `POST /v1beta/models/*` | user token / session | Gemini format |
| `/gemini/*` `/mistral/*` `/openrouter/*` `/elevenlabs/*` `/stability/*` | user token / session | native passthrough |
| `POST /admin/keys/import` | admin | bulk-import `provider:key` lines |
| `GET /admin/keys/list` | admin | every key + stats |
| `POST /admin/keys/:id/check` | admin | live liveness / balance probe |
| `POST /admin/keys/:id/enable\|disable`, `DELETE /admin/keys/:id` | admin | per-key ops |
| `POST /admin/keys/:id/live-models`, `POST /admin/keys/:id/models` | admin | fetch live models for a key / add models |
| `POST /admin/providers/:provider/live-models` | admin | live model list for a provider |
| `POST /admin/check-all-keys` | admin | batch probe: revive healthy, disable dead |
| `POST /admin/probe-models` / `GET /admin/models-status` | admin | model-level availability |
| `POST /admin/sweep`, `POST /admin/probe` | admin | revive cooldowns / probe disabled keys |
| `GET /admin/users`, `POST /admin/users/:id/approve\|block` | admin | approve consumers |
| `GET/POST/DELETE /me/tokens` | session / user token | consumers manage their own tokens |
| `GET /me/usage` `/me/logs` `/me/balance` `/me/transactions` | session / user token | consumer metering |
| `POST /me/checkout` `POST /stripe/webhook` | session / none | Stripe credit top-up |
| `GET /admin/usage` `/admin/logs` `/admin/balances` `/admin/prices` | admin | metering & billing |

### Import keys

```bash
curl https://YOUR_WORKER/admin/keys/import \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"keys":"gemini:AIza...\nmistral:...\nopenrouter:sk-or-v1-..."}'
```

### Use it

```bash
curl https://YOUR_WORKER/v1/chat/completions \
  -H "Authorization: Bearer <user-token>" \
  -H 'content-type: application/json' \
  -d '{"model":"mistral-small-latest","messages":[{"role":"user","content":"hi"}]}'
```

## Notes

- **Terms of service:** aggregating / sharing / reselling provider API keys may
  violate the upstream providers' terms. Use it to pool **your own** keys, and
  review each provider's ToS before exposing it to others.
- SSO is optional — leave `OIDC_*` unset to run with `ADMIN_TOKEN` + minted
  tokens only.
- A model not in the static catalog can still be called: the OpenRouter route
  passes unknown model ids through, and the per-key **新增模型** flow adds
  live-fetched models to `/v1/models`.

## License

MIT
