# Deployment

Three deployables: **web** (Vercel), **database/storage** (Supabase), **GPU
worker** (Modal, or any CUDA host via Docker). The web app works on its own —
every integration is optional and degrades cleanly.

## 0. Prerequisites
Node ≥ 20.11, npm; Supabase CLI; a Telegram bot (BotFather); Stripe account;
Anthropic API key; (HD) Modal account + FLAME licence.

## 1. Local development
```bash
cd apps/web
cp .env.example .env.local        # everything optional locally
npm install
npm run dev                       # copies MediaPipe WASM/models into public/, starts :3000
npm test                          # vitest (linalg, look schema, Telegram crypto)
npm run typecheck
```
Open `/` (landing), `/create` (scan), `/studio?demo=1` (demo twin).
Regenerating the template rig (only if you change the template head):
`npm run dev` in one shell, then `LAB_URL=http://localhost:3000 npm run rig:template`.

## 2. Supabase
```bash
supabase link --project-ref <ref>
supabase db push                  # applies supabase/migrations/*.sql (schema, RLS, functions, buckets)
```
Copy `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`, `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only).
For the worker use the **session pooler** connection string as `DATABASE_URL`.

## 3. Web on Vercel
1. Import the repo, **Root Directory = `apps/web`**, framework Next.js.
2. Environment (Production):
   `NEXT_PUBLIC_SITE_URL`, `SESSION_SECRET` (`openssl rand -base64 48`), Supabase vars,
   `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`,
   `ANTHROPIC_API_KEY` (+ `STYLIST_MODEL=claude-opus-5-5`, `STYLIST_EFFORT=low`),
   Stripe keys + price ids, `RECON_WEBHOOK_SECRET` (≥ 32 chars), `CRON_SECRET`,
   optional `OPENAI_API_KEY` + `OPENAI_FALLBACK_MODEL`, `RECON_TRIGGER_URL` + `RECON_TRIGGER_TOKEN`.
3. `apps/web/vercel.json` already configures the daily purge cron (Vercel sends `Authorization: Bearer $CRON_SECRET`) and function durations. Region `fra1` (EU data residency; change as needed). Hobby only allows daily crons; on Pro you can switch it to hourly (`17 * * * *`) for a ≤ 25 h deletion window.
4. Deploy. Check `https://<host>/api/health`.

### Troubleshooting
| Symptom | Cause / fix |
|---|---|
| "No Next.js version detected" / build can't find `package.json` | Root Directory isn't `apps/web` (Project → Settings → Build and Deployment → Root Directory), then redeploy. The app lives in a subfolder, and `vercel.json` there is only read with that root. |
| "Hobby accounts are limited to daily cron jobs" | Old commit with the hourly cron — pull the latest branch. |
| Site loads but `/api/*` returns 500 | `SESSION_SECRET` not set (≥ 32 chars). Production fails closed without it by design. Redeploy after adding env vars. |
| Accounts / AI Stylist / payments disabled | The matching env vars are missing — the 3D studio still works without them. |

## 4. Telegram
```bash
# Mini App: BotFather → /newapp (or Bot Settings → Configure Mini App) → URL https://<host>/tg
# Login Widget: BotFather → /setdomain → <host>
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url="https://<host>/api/telegram/webhook" \
  -d secret_token="$TELEGRAM_WEBHOOK_SECRET" \
  -d allowed_updates='["message","pre_checkout_query"]'
```
Stars subscriptions need no provider token. Test with a test-environment bot first.

## 5. Stripe
Create three recurring prices (Pro $12, Barber $49, Clinic $199) → env ids.
Webhook endpoint `https://<host>/api/webhooks/stripe` with events
`checkout.session.completed`, `customer.subscription.created|updated|deleted|paused|resumed` → `STRIPE_WEBHOOK_SECRET`.
Enable the Customer Portal.

## 6. GPU worker (HD Twins)
```bash
cd services/reconstruct
bash scripts/fetch_models.sh                       # MediaPipe models
# FLAME (licensed): convert once, upload to a Modal volume
python scripts/convert_flame.py --flame … --uv … --mediapipe … --out ./flame
modal volume create twinme-flame && modal volume put twinme-flame ./flame /
modal secret create twinme-recon DATABASE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  WEB_URL=https://<host> RECON_WEBHOOK_SECRET=… RECON_TRIGGER_TOKEN=…
modal deploy modal_app.py                          # prints the trigger URL → RECON_TRIGGER_URL on Vercel
pytest -q                                          # CPU tests (texture, rig, analysis, signatures)
```
Self-hosted alternative: `docker build -t twinme-recon . && docker run --gpus all -v /path/flame:/models/flame:ro --env-file .env twinme-recon`.

## 7. Production checklist
- [ ] `SESSION_SECRET` set (app refuses to start without it)
- [ ] `npm audit --omit=dev` clean; CSP verified in the browser console (no violations on `/`, `/create`, `/studio`, `/tg`)
- [ ] Telegram webhook secret set; Mini App opens full-screen; vertical swipes disabled
- [ ] Stripe live keys + webhook; Stars prices set
- [ ] Purge cron running (check `captures.purged_at`)
- [ ] FLAME commercial licence before charging for HD Twins
- [ ] Error monitoring (Sentry) and uptime checks on `/api/health`
