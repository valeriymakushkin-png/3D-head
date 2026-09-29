# TwinMe AI

**Your photoreal 3D digital twin.** Scan your head in 15 seconds, get a real 3D
model of *you*, and try any haircut, beard, colour, glasses or complexion on it
in real time — rotating 360°, with an AI stylist that restyles you as it talks.

This is not a photo filter: the head is a sculpted 3D mesh fused from your own
photos, the hair is 40–150k strands grown on your actual scalp, and everything
you see is rendered live at 60 fps.

## What's here

| | |
|---|---|
| `apps/web` | Next.js 15 app: landing (live 3D hero), capture (guided scan / photos / video), **on-device Instant Twin reconstruction**, studio (R3F), AI Stylist, Glow Up, Telegram Mini App, API (auth, metering, billing, webhooks) |
| `services/reconstruct` | Python GPU worker for **HD Twins**: multi-view FLAME fitting (PyTorch3D), delit multi-band texture baking, GLB export; Modal scale-to-zero deployment |
| `supabase` | Postgres schema, RLS, atomic metering / queue functions, private buckets |
| `docs` | [Architecture](docs/ARCHITECTURE.md) · [Pipeline](docs/PIPELINE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [UI tree](docs/UI.md) · [Design system](docs/DESIGN_SYSTEM.md) · [Telegram](docs/TELEGRAM.md) · [Roadmap](docs/ROADMAP.md) · [Scaling to 1M](docs/SCALING.md) · [Security](docs/SECURITY.md) · [Deployment](docs/DEPLOYMENT.md) |

## Quick start

```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
```

* `/` — landing with a live, rotating 3D twin cycling through looks
* `/create` — scan yourself (camera) or upload 5–15 photos / a selfie video → your twin in seconds, built on-device
* `/studio?demo=1` — the studio with the demo head
* `/lab?hair=quiff&beard=short&glasses=aviator&view=34l` — deterministic engine renders; `/lab?mode=recon` runs the full reconstruction on synthetic selfies

No keys are needed for the core product: capture, reconstruction, the 3D
studio, Glow Up (deterministic style engine) and exports run entirely in the
browser. Add Supabase / Telegram / Anthropic / Stripe keys to enable accounts,
the AI Stylist, metering and payments (see `.env.example`).

## Tests

```bash
cd apps/web && npm test && npm run typecheck && npm run build
cd services/reconstruct && pip install -e .[dev] && pytest -q
```

## Stack

Next.js 15 · React 19 · TypeScript · Tailwind v4 · Framer Motion · three.js /
React Three Fiber / drei · three-mesh-bvh · MediaPipe Tasks (WASM) · Zustand ·
Zod · Supabase (Postgres, Storage) · Anthropic Claude (Opus 5.5) with optional
OpenAI failover · Stripe · Telegram Mini Apps & Stars · PyTorch3D + FLAME ·
Modal · Vercel.

## Credits & licences

Demo/template head: "Lee Perry-Smith" scan by Infinite-Realities, CC BY 3.0.
MediaPipe models: Apache-2.0. FLAME (HD pipeline) is licensed separately by
MPI-IS — see [docs/PIPELINE.md](docs/PIPELINE.md#4-licensing-read-before-launch).
