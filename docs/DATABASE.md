# Database schema

Source of truth: `supabase/migrations/20260929000000_init.sql` (Postgres 15).

```
users 1───* avatars 1───* captures
  │            │ 1
  │            └───1 reconstruction_jobs
  ├───* transformations (looks + metering ledger)
  ├───* subscriptions (stripe | telegram_stars)
  ├───* ai_usage
  ├───* clients 1───* consultations      (Barber plan)
  │         └────* patient_reports       (Clinic plan)
  └───* audit_log
billing_events (webhook idempotency) · rate_limits (unlogged)
```

## Tables

| Table | Purpose | Notes |
|---|---|---|
| `users` | identity | `telegram_id` / `email` unique; `is_anonymous` for pre-sign-up metering; `plan` + `subscription_status` are a cache maintained by `refresh_user_plan()` |
| `avatars` | digital twins in the cloud | `tier` instant/hd, `status` uploading→queued→processing→ready/failed, `model_url`/`thumbnail` are storage paths, `rig`/`analysis`/`natural_hair` jsonb (same contracts as the web) |
| `captures` | raw HD photos | `purge_after` = +24 h, `purged_at` set by the purge cron |
| `reconstruction_jobs` | GPU queue | one per avatar; `claim_reconstruction_job(worker)` (SKIP LOCKED, stale-lease reclaim), `heartbeat_reconstruction_job` |
| `transformations` | saved looks + free-tier ledger | `metered` true on the free plan; `settings` is a `Look`/patch jsonb |
| `subscriptions` | paid plans | unique `(provider, provider_subscription_id)`; `expires_at` drives entitlement |
| `billing_events` | exactly-once webhooks | PK = provider event id |
| `ai_usage` | tokens per AI call | unit economics & abuse detection |
| `clients`, `consultations`, `patient_reports` | professional plans | owned by the barber/clinic user |
| `audit_log` | security events | no face data |
| `rate_limits` | fixed-window counters | `UNLOGGED` (fast, loss-tolerant) |

## Functions

* `consume_transformation(user, type, avatar, settings, source, free_limit) → remaining`
  — row-locks the user, reads the expiry-aware `user_entitlements` view,
  raises `P0402` when the free quota is spent, inserts the ledger row.
* `hit_rate_limit(key, limit, window_s) → bool` — atomic upsert.
* `refresh_user_plan(user)`, `merge_users(from, into)`.

## Security

RLS enabled on every table. The BFF uses the service role and scopes every
query by the session's user id; `authenticated` policies (`user_id = auth.uid()`)
are in place for future direct client access; `anon` has no policies. All RPCs
are revoked from `public/anon/authenticated`. Buckets are private; objects are
reachable only through short-lived signed URLs.
