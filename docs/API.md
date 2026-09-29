# API

All endpoints are Next.js route handlers under `apps/web/src/app/api`. JSON in,
JSON out (except the SSE stylist). Auth = session cookie `tm_session` **or**
`Authorization: Bearer <jwt>` (Telegram). Errors: `{ "error": code, "message"? }`.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | — | feature flags + build version |
| `GET /api/me` | optional | `{ user, plan, status, remainingTransformations, backend }` |
| `POST /api/auth/telegram` | — | `{ initData }` → `{ token, user, startParam }` + cookie (Mini App) |
| `GET /api/auth/telegram-login` | — | Login Widget callback (signed query) → cookie → redirect `next` |
| `POST /api/auth/logout` | session | clears cookie |
| `POST /api/transformations` | session (anonymous ok) | meter + record `{ type: glow_up\|stylist\|look, avatarId, settings }` → `{ remaining }` · **402** `quota_exceeded` |
| `GET /api/transformations` | session | saved looks (lookbook) |
| `POST /api/stylist` | session (anonymous ok) | **SSE** stream of `StylistEvent` (see below); meters 1 transformation on Free |
| `POST /api/glow-up` | session | `{ analysis, before, after, patch }` → `{ headline, rationale[] }` |
| `POST /api/avatars` | Pro+ | start HD twin: `{ source, captures[3–15], analysis? }` → `{ avatarId, uploads[{index,url,contentType}] }` |
| `GET /api/avatars` | session | list cloud avatars |
| `GET /api/avatars/:id` | owner | status, job, signed `model_url` (10 min) when ready |
| `DELETE /api/avatars/:id` | owner | erase files + soft-delete |
| `POST /api/avatars/:id/submit` | owner | verify uploads → enqueue GPU job (+ optional instant trigger) |
| `POST /api/billing/checkout` | signed-in | `{ plan, returnTo }` → Stripe Checkout `url` |
| `POST /api/billing/portal` | signed-in | Stripe customer portal `url` |
| `POST /api/billing/telegram-invoice` | Telegram session | `{ plan }` → Stars subscription invoice `url` |
| `POST /api/webhooks/stripe` | Stripe signature | subscription lifecycle (idempotent) |
| `POST /api/telegram/webhook` | secret-token header | `/start`, `pre_checkout_query`, `successful_payment` |
| `POST /api/webhooks/reconstruct` | HMAC `x-twinme-signature` | GPU worker → user notification |
| `GET /api/cron/purge` | `Bearer CRON_SECRET` | delete captures > 24 h, GC anonymous users |

## Stylist SSE protocol (`lib/ai/protocol.ts`)

Request:
```json
{ "messages": [{ "role": "user", "content": "Make me look more professional" }],
  "context": { "analysis": FaceAnalysis, "look": Look } }
```
Events (`data: <json>\n\n`):
```jsonc
{ "type": "usage", "remaining": 2 }               // null = unlimited
{ "type": "text", "delta": "Your jaw is already strong…" }
{ "type": "apply", "label": "Taper Fade · Stubble", "patch": LookPatch }   // studio applies instantly
{ "type": "options", "options": [{ "label", "why", "patch" }] }            // tappable cards
{ "type": "error", "code": "quota_exceeded|rate_limited|unavailable|…", "message": "…" }
{ "type": "done" }
```

## Rate limits

| Key | Limit |
|---|---|
| stylist per user | 20 / min (+ 60 / min per IP) |
| glow-up narration | 10 / min |
| transformations | 30 / min |
| HD avatars | 5 / hour |
| checkout | 10 / 5 min |
| Telegram auth per IP | 30 / min |
