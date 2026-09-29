# Roadmap

## North-star metric
**Weekly users who applied a look to their own twin** (the "aha"). Leading
indicators: scan completion rate, time-to-first-look, looks per session, free →
Pro conversion, Telegram share rate.

## MVP (weeks 0–8) — *this repository*
| Week | Deliverable | Status |
|---|---|---|
| 1–2 | Procedural strand hair, beard, glasses, skin on a scanned template; studio shell | ✅ |
| 2–3 | Guided capture (MediaPipe), photo/video upload, on-device Instant Twin (fuse → sculpt → bake) | ✅ |
| 3–4 | Studio: live previews, own-twin thumbnails, fine-tune sliders, undo/redo, compare | ✅ |
| 4–5 | Style engine + Glow Up (3D before/after); AI Stylist (Claude, tools, SSE) | ✅ |
| 5–6 | Telegram Mini App, Telegram auth, Stars subscriptions; Stripe on web | ✅ |
| 6–7 | Supabase schema, metering, HD Twin queue + GPU worker, purge cron, CSP | ✅ |
| 7–8 | Private beta (200 users via Telegram channels), instrument funnel, fix top-10 capture failures | ⏭ next |

**Launch gates:** scan success ≥ 85 % first try · p75 Instant Twin ≤ 12 s on iPhone 12 / Pixel 6 · studio ≥ 45 fps on mid-range Android at `medium` · zero P0 security findings · FLAME commercial licence signed before HD goes paid.

## Phase 1 — Men 18–40: hair & beard (months 2–6)
* 25 → 60 hairstyles (textures: coils, waves; lengths; parts), beard shaping (necklines, cheek lines)
* "Show my barber": shareable 3D link + PDF card with guard numbers and photos from 4 angles
* Lookbook sync across devices; referral loop in Telegram (share your twin → friend scans)
* Own template head (in-house scan, 4K, open eyes, commercial rights) replacing the CC-BY demo scan
* Hair colour realism: dual-tone, highlights, grey blending

## Phase 2 — Glasses, clothing, style (months 6–12)
* Real frame catalogue (SKU-accurate dimensions from partners; affiliate revenue), PD-accurate fit, virtual try-on share
* Clothing on the bust: necklines, knitwear, shirts with collars (cloth-sim-lite), colour-palette analysis (seasonal)
* Gaussian-splat HD Twin (FLAME-rigged Gaussians) for photoreal skin & hair silhouettes; hybrid rendering with procedural hair
* Personal stylist mode: full-look recommendations (hair + beard + frames + palette) with brand links

## Phase 3 — Professionals (months 9–18)
* **Barber plan**: client twins, consultation mode on a shared screen, saved cuts per client, booking integrations (Booksy, Fresha)
* **Clinic plan**: hairline design tool (drawn on the scalp), graft-count estimation by zone density, before/after timeline, patient PDF reports, consent capture, HIPAA/GDPR DPAs
* Plastic-surgery visualisation (rhinoplasty/chin) — only with medical partners, clear disclaimers, and regulatory review per market
* Team seats, SSO, white-label studio embed (iframe SDK)

## Business model
| Plan | Price | Target | Gross margin driver |
|---|---|---|---|
| Free | $0 | everyone | on-device compute → ~$0 marginal cost |
| Pro | $12/mo (600 ⭐) | consumers | AI ≈ $0.02–0.05 per stylist turn with caching; HD twin ≈ $0.013 |
| Barber | $49/mo | barbershops | seats, consultations |
| Clinic | $199/mo | hair-restoration clinics | reports, compliance |
Year-1 target: 250k twins created, 3.5 % Pro conversion, 400 barbershops, 40 clinics → ≈ $1.7M ARR.
