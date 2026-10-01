# TwinMe AI — Production Architecture

> The avatar is the product. Every architectural decision below serves one goal:
> the user's own head, in real 3D, changing in real time — on a phone, inside
> Telegram, in under a minute from first tap.

## 1. System overview

```
                         ┌───────────────────────────── Client (browser / Telegram WebView) ─────────────────────────────┐
                         │                                                                                                 │
  camera / photos ──────►│  Capture (MediaPipe WASM)  ──►  Instant Twin reconstruction (WebGL2 + JS, on-device, 5–15 s)  │
                         │        │ 478 landmarks, pose, segmentation        │ fuse → sculpt → bake 2K texture → analyse     │
                         │        ▼                                           ▼                                                │
                         │  IndexedDB vault (private by default)      Studio (React Three Fiber)                               │
                         │                                              ├─ Avatar worker (hair/beard strands, BVH, SDF)        │
                         │                                              ├─ Render pipeline (main view · 4 live previews ·      │
                         │                                              │   carousel thumbnails · before/after split)           │
                         │                                              └─ Style engine (deterministic, offline)                │
                         └───────────────┬───────────────────────────────────────┬──────────────────────────────┬──────────┘
                                         │ HTTPS (session cookie / Bearer)        │ signed PUT (HD photos only)   │ SSE
                                         ▼                                        ▼                               │
┌──────────────── Vercel (Next.js 15, Node runtime, fra1) ────────────────┐   ┌──────── Supabase ────────┐        │
│ Middleware: nonce CSP, HSTS, framing rules                               │   │ Postgres 15 (RLS on)     │        │
│ BFF route handlers:                                                      │──►│  users · avatars ·        │        │
│  /api/auth/*        Telegram initData & Login Widget → JWT session       │   │  captures · jobs ·        │        │
│  /api/transformations  metering (consume_transformation, atomic)         │   │  transformations ·        │        │
│  /api/stylist       Claude Opus 5.5 streaming + client-side look tools ◄─┼───┼── subscriptions · ...    │        │
│  /api/glow-up       structured-output narration                          │   │ Storage (private)        │        │
│  /api/avatars/*     HD twin orchestration (signed uploads, queue)        │   │  captures (24 h TTL) ·   │        │
│  /api/billing/*     Stripe Checkout · Telegram Stars invoices            │   │  avatars · thumbnails    │        │
│  /api/webhooks/*    Stripe · Telegram bot · GPU worker (HMAC)            │   └────────────▲─────────────┘        │
│  /api/cron/purge    privacy TTL enforcement (Vercel Cron)                │                │ SKIP LOCKED queue    │
└──────────────┬──────────────────────────────────┬───────────────────────┘                │                      │
               │ Anthropic API (primary)          │ Stripe / Telegram Bot API    ┌──────────┴──────────────┐       │
               │ OpenAI (optional failover)       │                              │ GPU worker (Modal, L4)  │       │
               ▼                                  ▼                              │ FLAME multi-view fit ·  │       │
          LLM providers                     Payment providers                    │ texture bake · GLB      │───────┘
                                                                                 └─────────────────────────┘
```

## 2. Two-tier reconstruction (the core decision)

| | **Instant Twin** (default, free) | **HD Twin** (Pro) |
|---|---|---|
| Where | In the browser (WebGL2 + MediaPipe WASM) | GPU worker (Modal L4, PyTorch3D) |
| Input | Face-ID-style guided scan (7 pose bins) / 5–15 photos / 15 s video | same frames, uploaded encrypted |
| Geometry | Template head (scan) → lightly regularised affine + Gaussian-RBF warp through 468 fused landmarks | FLAME fitted jointly to all views (landmarks + silhouette + photometric) |
| Texture | 2K atlas, projected from every view with visibility, facing⁴, skin-segmentation weights, per-view exposure gain, SH de-lighting and skin calibration | 2K atlas, SH-delit, Laplacian multi-band blended, per-vertex albedo fill |
| Time | 5–15 s on a phone | 40–90 GPU-s, async, Telegram notification |
| Privacy | Photos never leave the device | Photos hard-deleted ≤ 48 h |
| Cost to us | $0 | ≈ $0.012 per twin (L4 @ ~$0.80/h) |

**Guided scan.** A light screen (it doubles as a soft box for the face) with a
round camera view: first "look straight" (the front view is taken once the
face is centred, level and still), then "roll your head in a circle" while a
ring of 72 ticks fills in every direction covered. Frames are binned by head
pose and the sharpest per bin is kept; the headline names the open part of
the ring or the exact pose a missing view needs.

**Likeness details** (measured against a real head scan in the lab: the scan,
optionally morphed — wider/narrower jaw, nose, cheeks — goes through a
synthetic selfie session and the twin is scored in mm against it):

- *Calibrated landmarks.* The tracker's landmarks are biased (its outline
  points sit ~15 % inside the jaw seen from 7 close views); the template's
  `fitLandmarks` are the template measured by this same pipeline, so sculpting
  compares like with like (blended by how many side views were captured).
- *Proportions without shear*: similarity + one scale per axis (a free affine
  can tilt the whole head).
- *Jaw outline* from the frontal segmentation (mouth corners → chin), gated
  against the tracker's contour and limited to −7…+8 %.
- *Cameras* are fitted to the model's surface landmarks with a rigid depth
  axis and perspective (focal from the phone's front camera or EXIF); side
  photos texture the face only, the fill covers ears and the back of the head.
- *Texture*: each photo's lighting (order-2 SH of the normal) is divided out
  gently; skin calibrated towards the template's albedo range (exposure only
  part-way — a dim room and darker skin look alike); outside the face oval and
  above the brows only skin-like samples are kept (no hair bands at the
  hairline); below the jaw line the fill takes over.
- *Hair*: the fringe is measured from the brows up, plus hair over the temples
  and ears; ears are masked out of hair roots and scalp tint and the hairline
  wraps around them; a bald scalp gets no stubble.

Why: the "aha" (seeing *yourself* in 3D with a new haircut) must happen before
sign-up and before paying. Doing it on-device gives zero marginal cost, zero
latency queue, and a privacy story no competitor can match. The GPU tier adds
fidelity for users who've already converted.

## 3. Real-time appearance engine

* **Hair is generated, not modelled.** `lib/hair/generate.ts` grows 40–150k
  strands on the real scalp of *this* head: roots from BVH ray casts, per-style
  flow fields, a signed-distance "hair shell" that keeps hair on (and around)
  the skull, curl, flyaways and guide/child clumping. Styles are ~20 numbers
  (`HAIRSTYLE_PRESETS`), so any cut fits any head and sliders are continuous.
* **Off the main thread.** `lib/engine/core.ts` (run by `avatar.worker.ts`, or
  in-thread if a browser can't start the worker) owns the BVH, scalp samples
  and SDF per head; regenerating a cut never drops a frame. Channels (`main`,
  `before/after`, `thumb`) are latest-wins.
* **Baked studio lighting** (`lib/hair/shading.ts`). The head never moves
  relative to the studio lights — the camera orbits — so hair self-shadowing
  is precomputed like a deep opacity map: the groom is splatted into a 3 mm
  density grid and every strand point stores its visibility of each of the
  four lights (through hair, then a soft SDF march through the head) plus
  its depth-in-groom occlusion. The same grid shadows the skin (fringe on the
  forehead, scalp under a crop) and SDF cavities give the face its ambient
  occlusion. Result: real depth in the hair at zero per-frame cost.
* **One render pipeline** (`components/three/RenderPipeline.tsx`) per frame:
  ≤1 carousel thumbnail of *your own twin* wearing each option, the 4 live
  orthogonal previews (only when the avatar changed), then the main view or the
  live before/after split. Sub-renders go through the default framebuffer so
  tone mapping and colour management are identical everywhere.
* **Skin** is three.js `MeshPhysicalMaterial` with injected mask channels:
  stubble shadow, captured-beard removal ("clean shave" on a bearded scan),
  scalp density tint, and feature-protected complexion smoothing. Direct
  light wraps past the terminator per channel (a subsurface approximation —
  red travels furthest), each light is scaled by its baked visibility, and a
  thin clearcoat adds the second specular lobe of skin oil. A dark crew-neck
  (`Shirt.tsx`) is the body mesh pushed out along its normals and cut by a
  collar plane in the shader.
* **Eyes.** The template scan has closed lids, so for a twin captured with
  open eyes the skin shader cuts the palpebral fissure along the user's own
  lid contour and eyeballs sit behind it (`lib/three/eyes.ts`): sclera, the
  iris in the colour sampled from the front photo, pupil, a glossy cornea for
  catchlights and a dark socket so the canthi never show a hole.
* **Texture bake** (`lib/recon/bake.ts`): the front photo owns the face and
  alone supplies the eyes and mouth (blinks and smiles never blend); skin no
  photo saw (under a fringe, the neck, the back of the head) is inpainted
  through the accumulator's mip chain from the neighbouring photographed
  skin, then given the template's pore detail as a luminance ratio.
* **Landing hero** is not real-time: a Blender Cycles path-traced loop of the
  template twin with the engine's own groom (`scripts/cycles`), so the first
  impression costs the phone a short video instead of a WebGL scene.
* **Glasses / accessories** are procedural and fitted from the rig (pupils,
  sellion, temples, ear points) with real optics details (12 mm vertex
  distance, 8° pantoscopic tilt, 5° wrap).

## 4. AI layer

* **Style engine** (`lib/style/engine.ts`) — deterministic barbering and
  optical heuristics over a *soft* face-shape distribution, plus goals and
  concerns (thinning). Powers Glow Up offline and grounds the LLM.
* **AI Stylist** (`server/ai/stylist.ts`) — Claude Opus 5.5 via streaming
  Messages API, adaptive thinking at `low` effort (configurable), two
  client-side tools (`apply_look`, `suggest_looks`) validated with the same Zod
  schema the studio uses. Stable system prompt + per-user facts are prompt-
  cached; the live look rides in a mid-conversation system message so the cached
  prefix never changes. Server-side refusal fallbacks are enabled
  (`fallbacks: "default"`). Optional OpenAI failover for provider outages.
* **Privacy:** the LLM never receives photos — only numeric measurements,
  categorical skin tone and the current look JSON.

## 5. Identity, sessions, metering

* Telegram-first identity: Mini App `initData` (HMAC-SHA256, 24 h freshness)
  and the Login Widget on the web. Anonymous users get a server-side user row
  on first metered action, so the free tier (3 AI transformations) is enforced
  before sign-up and merged on sign-in (`merge_users`).
* Sessions are stateless HS256 JWTs (httpOnly, `SameSite=None; Partitioned`
  for Telegram Web's iframe) and are also accepted as Bearer tokens.
* Metering is a single Postgres function (`consume_transformation`) that
  row-locks the user, checks the *effective* plan (expiry-aware view) and
  records the ledger entry atomically → no double-spend under concurrency.

## 6. Payments

* Web: Stripe Checkout (subscriptions) + Customer Portal; webhooks are
  signature-verified, idempotent (`billing_events`), and always re-read the
  subscription from Stripe (out-of-order safe).
* Telegram: digital goods must be sold in Stars → `createInvoiceLink` with
  `subscription_period = 30 days`; `pre_checkout_query` validates the payload
  owner; `successful_payment` extends the subscription.

## 7. Repository layout

```
(repo root)                   Next.js 15 app (landing, capture, studio, Telegram, API) — deploys to Vercel as-is
src/app/                      routes (App Router) + api/ route handlers
src/components/three/         R3F scene: Avatar, HeadMesh, StrandMesh, RenderPipeline, CameraRig, Stage
src/components/studio/        Studio UI: TopBar, PreviewRail, StyleDock, StylistPanel, GlowUp, Sheets
src/components/capture/       CreateFlow, GuidedScan, UploadPhotos
src/components/landing/       Hero (live 3D), Reveal
src/components/telegram/      TgApp shell
src/lib/hair/                 strand generator, regions, SDF, style presets
src/lib/head/                 rig (anatomical frame), head asset loaders
src/lib/recon/                MediaPipe, capture, fusion, warp, GPU texture bake, analysis, vault
src/lib/three/                skin/hair materials, glasses, accessories, masks, lighting
src/lib/style/                face analysis + style engine
src/lib/engine/               worker protocol/client, thumbnails, previews, scene bus
src/server/                   env, db, session, telegram, billing, metering, AI (server-only)
public/models/template/       template head scan (CC BY 3.0) + auto-generated rig.json
services/reconstruct/         Python GPU worker (FLAME fitting, texture, GLB) + Modal app
supabase/                     migrations (schema, RLS, functions, buckets), local config
docs/                         this documentation
```

## 8. Key trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Instant reconstruction | On-device template warp + projection | Server-only | $0 marginal cost, privacy, instant aha |
| HD geometry | FLAME + PyTorch3D (BSD) | nvdiffrast / DECA / EMOCA | licences (NVIDIA/MPI non-commercial), keep one licensed dependency (FLAME) |
| Hair | Procedural strands | Artist hair cards / NeRF hair | fits every head, continuous sliders, tiny payloads |
| Queue | Postgres `SKIP LOCKED` | Redis/SQS | one datastore, transactional with job state, plenty for 10⁵ jobs/day |
| Rate limiting | Postgres fixed window | Upstash | no extra vendor at MVP scale; swap-in at 10⁶ MAU (see SCALING) |
| Auth | Telegram-first, JWT sessions | Supabase Auth | Mini App needs initData auth; one mechanism for web + Telegram |
| LLM | Claude Opus 5.5 (tools + caching) | fine-tuned small model | quality of grounded advice is the product; cost controlled via caching + effort |
