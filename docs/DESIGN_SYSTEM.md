# Design system — "Graphite & Light"

The face is the only colourful thing on screen. UI is graphite glass that
floats over a cinematic stage, with one iridescent accent reserved for AI.

## Principles
1. **The avatar is the interface.** ≥ 75 % of the viewport; chrome floats, never frames.
2. **Quiet until touched.** Low-contrast glass at rest, crisp on hover/active.
3. **One accent, one meaning.** Iridescent ring (`ai-ring`) = AI. Champagne (`aura`) = your best version. Nothing else is coloured.
4. **Real light.** Studio lighting on the avatar, soft shadows and inner highlights on glass, grain + vignette for film.
5. **Few words.** Labels ≤ 3 words; explanations only where a decision is made.

## Tokens (`apps/web/src/app/globals.css`, Tailwind v4 `@theme`)

| Token | Value | Use |
|---|---|---|
| `ink-950 … ink-500` | #050506 → #363a43 | stage, surfaces, strokes |
| `mist-50 … mist-500` | #f6f6f8 → #686b75 | text hierarchy (50 = primary, 300 = secondary, 500 = tertiary) |
| `iris-200 … iris-500` | #dde3ff → #7d8bff | AI affordances only |
| `aura-300/400` | #ffd9bd / #f4bf96 | Glow Up |
| `ok/warn/err-400` | #7ee2b0 / #ffcf70 / #ff8a8a | status |
| `--font-display` | Inter Tight 600, tracking −0.02 … −0.045em | headlines |
| `--font-sans` | Inter 400/500 | UI |
| `--font-serif` | Instrument Serif italic | editorial accents ("*digital twin.*") |
| radii | 18 (cards) · 22–30 (panels) · 999 (pills) | |
| motion | `ease-out-expo` cubic-bezier(.16,1,.3,1); springs 420/36; 0.35–0.9 s | |

## Surfaces
* `glass` — gradient graphite at ~60 % alpha, `blur(28px) saturate(160%)`, 1 px white/8 % border, inner top highlight, deep soft drop shadow. Opaque fallback where `backdrop-filter` is unsupported.
* `glass-soft` — 4.5 % white, lighter blur: secondary tiles.
* `ai-ring` — 1 px animated conic gradient border (iris → aura → mint).
* `stage-vignette` + `grain` — pure CSS film treatment over WebGL.

## Components
Button (`glass | solid | ghost | ai`, `sm | md | lg | icon`), Slider (pill track,
live value, keyboard), Kbd, category pill with shared-layout highlight, style
card (thumbnail of the user's twin, 2 px ring when active), swatch, sheet
(bottom on mobile, centred on desktop), toast chip, hairline icon set (1.5 px,
24 grid) in `components/ui/icons.tsx`, wordmark (two overlapping profiles).

## Layout
* Desktop: top bar · left tool rail · right preview rail · bottom dock (≤ 1080 px) · stylist sheet right (400 px).
* Mobile / Telegram: same hierarchy, compact dock (76 px cards), previews 60×74, stylist as bottom sheet, safe-area aware (`--tg-safe-*`).

## Motion
Enter: 16–24 px rise + fade, `ease-out-expo`, staggered 25–80 ms. Camera: critically-damped (smoothTime 0.32 s), dolly-to-cursor. Thumbnails fade in as they render. `prefers-reduced-motion` collapses all animation.

## Accessibility
Contrast ≥ 4.5:1 for text on glass (mist-300 on ink), focus rings (`iris-400/60`), sliders are ARIA sliders with arrow keys, all icon buttons labelled, keyboard shortcuts (⌘K, ⌘Z, 1–4, space, G), reduced motion respected.
