# Security & privacy architecture

A 3D face model is **biometric data** (GDPR Art. 9, BIPA, CCPA/CPRA,
Texas CUBI). The architecture minimises what we ever hold.

## Data minimisation by design
* **Instant Twins never leave the device** (IndexedDB). Photos, landmarks, mesh, texture stay local.
* **HD Twins**: photos go browser → private bucket via one-time signed upload URLs (the app server never proxies face data), are processed once, and are **hard-deleted within 24 h** by `/api/cron/purge` (`captures.purge_after`).
* **LLM calls carry no images** — only numeric measurements, categorical skin tone and look JSON. No training on customer data (provider terms).
* Avatar deletion erases storage objects immediately and nulls derived fields.

## Identity & sessions
* Telegram Mini App `initData` verified with HMAC-SHA256 (key = HMAC("WebAppData", bot token)), constant-time compare, 24 h freshness; Login Widget verified with SHA256(bot token). Both tested (`server/telegram.test.ts`).
* Sessions: HS256 JWT (issuer/audience pinned, 30 d), httpOnly, `Secure`, `SameSite=None; Partitioned` (CHIPS) for Telegram Web; also accepted as Bearer. Production refuses to boot without `SESSION_SECRET`.
* Open-redirect-safe `next` parameters (same-origin paths only).

## Authorization
* BFF pattern: every query scoped by the session user id; service-role key is server-only (`import "server-only"`).
* RLS on all tables (defence in depth); RPCs revoked from public roles; buckets private; signed URLs expire in 10 min.
* Plan checks server-side (`effectivePlan` view is expiry-aware); quotas enforced atomically in Postgres.

## Web hardening
* Per-request nonce CSP with `'strict-dynamic'`, `'wasm-unsafe-eval'` (MediaPipe) and **no** `'unsafe-eval'` in production; `frame-ancestors 'none'` except `/tg` (Telegram only); `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`.
* HSTS preload, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (camera self-only, no mic/geo), COOP `same-origin-allow-popups`.
* All inputs Zod-validated with byte caps; LLM tool inputs validated with the same schemas before reaching the client; `LookPatch` is `.strict()` (no prototype/extra keys).
* Rate limits per user and per IP on auth, AI, metering, checkout and HD creation.

## Webhooks & integrations
* Stripe: signature on raw body, idempotency table, state re-read from Stripe.
* Telegram: `X-Telegram-Bot-Api-Secret-Token` constant-time check; `pre_checkout_query` verifies invoice payload ownership.
* GPU worker → web: HMAC-SHA256 over `timestamp.body`, 5-minute window (replay-safe). Worker → DB via least-privilege connection.

## AI safety
* Stylist system prompt forbids negative judgements on attractiveness, weight, age, ethnicity; no medical diagnosis (hair loss → dermatologist); off-topic refusal.
* Refusals handled (`stop_reason: "refusal"`) with server-side fallbacks enabled; outputs never executed — only validated look patches.
* Abuse: consent step for scanning others (pro plans), no minors (Terms), audit log for security events.

## Compliance checklist (pre-launch)
- [ ] DPIA for biometric processing; explicit consent screen before capture (EU, IL, TX, WA)
- [ ] DPAs with Supabase, Vercel, Anthropic, Modal, Stripe
- [ ] Data residency: EU project (fra1 / eu-central-1) for EU users
- [ ] Retention policy published (24 h captures, 30 d anonymous users, avatar until deletion)
- [ ] Pen test (web + Mini App) and dependency audit in CI (`npm audit --omit=dev` = 0 today)
- [ ] FLAME commercial licence; replace CC-BY template with owned scan
