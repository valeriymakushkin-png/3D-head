# Scaling to 1 million users

The architecture is built so the expensive part — reconstruction and real-time
rendering — runs on the user's device. Servers handle identity, metering,
payments, LLM calls and the optional HD GPU path.

## Load model at 1M MAU
| Metric | Assumption | Load |
|---|---|---|
| MAU / DAU | 1,000,000 / 150,000 | |
| Studio sessions | 1.4 per DAU | ~210k/day, peak ~12 req/s API (non-AI) |
| AI Stylist turns | 30 % of sessions × 3 turns | ~190k/day, peak ~8 concurrent streams/s |
| Glow Ups | 25 % of sessions | ~50k/day |
| HD Twins | 4 % Pro × 1.3/mo | ~1,700/day, peak ~6 concurrent GPU jobs |
| Instant Twins | 12 % of new users | ~20k/day — **$0 server cost** |

## Per-component plan
| Component | 10k MAU (today) | 1M MAU |
|---|---|---|
| Web/API | Vercel serverless, fra1 | Vercel multi-region (fra1, iad1, sin1); edge caching of static assets & MediaPipe/WASM (immutable, 1y) |
| Postgres | Supabase Pro, pooler | Supabase Team/Enterprise, 8–16 vCPU primary + read replica for analytics; PgBouncer transaction mode; partition `transformations`, `ai_usage`, `audit_log` by month |
| Rate limits | Postgres unlogged table | move to Upstash Redis (same interface in `server/ratelimit.ts`) once > 2k writes/s |
| Queue | Postgres SKIP LOCKED | fine to ~10⁵ jobs/day; beyond, SQS/Cloud Tasks with the same claim semantics |
| GPU | Modal L4, scale-to-zero, cap 20 | cap 60–100, reserved baseline off-peak; H100 batching of the fit stage (4–8 jobs/GPU) cuts cost 3× |
| Storage | Supabase Storage | same, with lifecycle rules; GLBs (~3–5 MB) behind signed CDN URLs; KTX2/Basis texture transcoding to cut 70 % transfer |
| LLM | Claude Opus 5.5, prompt caching, effort `low` | provisioned throughput / priority where available, per-tenant quotas, cache hit ≥ 80 % (stable prefix design), OpenAI failover |
| Payments | Stripe + Telegram Stars | + Apple/Google IAP if native apps ship |

## Cost at 1M MAU (monthly, estimate)
| Item | Cost |
|---|---|
| Vercel (Enterprise, bandwidth ~40 TB via CDN) | $8–12k |
| Supabase (compute + 25 TB egress + storage) | $6–9k |
| GPU (≈ 52k HD twins × 60 s L4) | ~$700 |
| LLM (≈ 5.7M stylist turns × ~$0.02: cached 1.5k-token prefix, ~1.3k uncached input, ~550 output incl. thinking at `low`, ~1.6 calls/turn for tool follow-ups — at $4/$20 per MTok) | ~$115k |
| Observability, email, misc | $3k |
| **Total** | **≈ $140k/mo** vs ≈ $500k MRR at 3.5 % Pro (+ B2B) |

LLM is the dominant variable cost → levers in order: prompt caching (already
structured), `low` effort default, short max_tokens, per-user daily caps on
Free, deterministic engine answers for common intents ("what suits my face?")
before calling the model.

## Client performance at scale
* Quality tiers (`detectQuality`): strand budgets 220k–1.4M vertices; DPR cap 2; thumbnails at `low`.
* Worker-based hair generation; previews only re-render on change; carousel renders ≤ 1 thumbnail/frame.
* WASM + models self-hosted, immutable caching; template head 700 KB; Instant Twin record ~800 KB in IndexedDB.
* Future: WebGPU renderer path (three.js WebGPURenderer) for 2–3× strand throughput on supported devices.

## Reliability
* SLOs: API p99 < 400 ms (non-AI), stylist first-token p95 < 2.5 s, HD twin p95 < 5 min, 99.9 % monthly availability.
* Idempotent webhooks, SKIP LOCKED leases with heartbeat + reclaim, retries with backoff (3 attempts), fail-open rate limiting, feature degradation (AI down → deterministic engine; backend down → on-device product keeps working).
* Observability: Vercel/OTel traces, Postgres `pg_stat_statements`, `ai_usage` cost dashboards, worker metrics JSON per job, Sentry for client WebGL/worker errors.
