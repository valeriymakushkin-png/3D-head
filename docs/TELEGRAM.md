# Telegram Mini App

Entry: `https://<host>/tg` (`app/tg/page.tsx` → `components/telegram/TgApp.tsx`).

## Setup (5 minutes)
1. **Create the bot**: in Telegram open [@BotFather](https://t.me/BotFather) → `/newbot` → pick a name and a
   username ending in `bot`. Copy the token.
2. **Attach the Mini App**: `/mybots` → your bot → **Bot Settings → Configure Mini App → Enable Mini App** →
   send `https://<host>/tg`. This adds an **Open** button to the bot's profile and makes
   `https://t.me/<bot>?startapp` open the app directly.
3. **Menu button** (optional, the button next to the message field): **Bot Settings → Menu Button** →
   URL `https://<host>/tg`, title `Open TwinMe`.
4. **Vercel → Settings → Environment Variables**: `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (without `@`) and
   `TELEGRAM_BOT_TOKEN`, then **Redeploy** (`NEXT_PUBLIC_*` values are baked in at build time).
5. **Login Widget on the website** (optional): BotFather → `/setdomain` → your bot → `<host>`.

The Mini App works before step 4 too (as an on-device demo); the token adds verified sign-in, and
Supabase adds synced accounts and Stars payments. The bot `/start` reply needs the webhook below.

## Native integration
| Concern | Implementation |
|---|---|
| Boot | loads `telegram-web-app.js` (nonce CSP), `ready()`, `expand()`, full-screen on iOS/Android (Bot API 8.0+) |
| Gestures | `disableVerticalSwipes()` — dragging the 3D head must never close the app |
| Chrome | header/background/bottom-bar colours = `#050506`; safe areas from `safeAreaInset` + `contentSafeAreaInset` → `--tg-safe-top/bottom`, updated on `safeAreaChanged`, `fullscreenChanged`, `viewportChanged` |
| Navigation | native `BackButton` in the capture flow; studio has none |
| Haptics | `HapticFeedback` on every captured angle, success/failure (`lib/telegram/webapp.ts → haptic`) |
| Auth | `initData` → `POST /api/auth/telegram` (HMAC verified) → JWT kept in memory (`setBearer`) — Telegram Web runs Mini Apps in a third-party iframe, so cookies are only a fallback |
| Deep links | `startapp=create` opens the scanner; bot notifications open `/tg?avatar=<id>` for finished HD twins |
| Payments | Stars subscription invoices (`createInvoiceLink`, `subscription_period=2592000`) opened with `openInvoice`; `pre_checkout_query` ownership check; `successful_payment` → subscription |
| Bot | `/start` replies with an "Open TwinMe" web-app button |
| Framing | CSP `frame-ancestors https://web.telegram.org https://*.telegram.org` only on `/tg` |

## Growth loops (Phase 1)
Share-to-story of a before/after render (`shareToStory`), referral start
params, weekly "new cuts on your twin" bot digest (opt-in).
