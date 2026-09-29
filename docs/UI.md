# UI component tree

```
app/layout.tsx                         fonts (Inter, Inter Tight, Instrument Serif), tokens, dynamic (CSP nonce)
├─ app/page.tsx  Landing
│  ├─ Nav (glass pill nav, Sign in, Create my twin)
│  ├─ Hero ── HeroTwinLazy → HeroTwin (live R3F showreel: Avatar + OrbitControls autoRotate, "Live 3D" chip)
│  ├─ HowItWorks (3 steps) · Features (bento: AI Stylist, Glow Up, Real 3D, Private, HD export)
│  ├─ Pros (barbers, clinics) · Pricing (4 plans) · Closing CTA · Footer (credits)
│  └─ Reveal (progressive-enhancement scroll reveal)
├─ app/create  CreateFlow
│  ├─ Choose (Guided scan | Upload) + HD Twin toggle (Pro) + privacy note
│  ├─ GuidedScan (camera, oval progress ring, pose map, auto-capture, hints)
│  ├─ UploadPhotos (drop zone, 7 pose slots, validation)
│  └─ Building (landmark cloud R3F canvas, staged progress)
├─ app/studio  StudioApp
│  ├─ StudioScene (AvatarCanvas)
│  │  ├─ StudioStage (4 directional lights + Lightformer environment)
│  │  ├─ CameraRig (camera-controls: damping, fly-to, turntable, 75 % framing)
│  │  ├─ StageBinder (exposes renderer to exporters)
│  │  ├─ group avatar-main | avatar-before + avatar-after (compare)
│  │  │  └─ Avatar
│  │  │     ├─ HeadMesh (skin material + masks)
│  │  │     ├─ StrandMesh "hair" · StrandMesh "beard" (worker-generated ribbons)
│  │  │     ├─ glasses group · accessories group
│  │  └─ RenderPipeline (thumbnails → previews → main / split)
│  ├─ TopBar (wordmark, twin chip, AI Stylist ⌘K, undo/redo, Best version, export)
│  ├─ ToolRail (turntable, reset, compare-with-real-you, new scan)
│  ├─ PreviewRail (Front · Left · Right · Back live canvases, fly-to)
│  ├─ AppliedToast (“Applied · Quiff · Stubble” + Undo)
│  ├─ StyleDock
│  │  ├─ category tabs (Hairstyles, Beard, Color, Glasses, Skin, Accessories) + Adjust
│  │  ├─ FineTune (swatches, Length/Volume/Texture, Density/Hairline, beard length, lens tint, complexion)
│  │  └─ Carousel (cards = thumbnails of *your* twin; custom colour picker)
│  ├─ CompareHandle (draggable 3D before/after divider)
│  ├─ GlowUpOverlay (analysing sequence → result card: Keep / Back to mine)
│  ├─ StylistPanel (chat, analysis chips, quick prompts, applied chips + undo, option cards)
│  ├─ ExportSheet (HD PNG up to 3840 px, GLB) · Paywall (Pro / Barber / Clinic)
├─ app/tg  TgApp (Telegram runtime: fullscreen, safe areas, BackButton, no swipe-to-close, initData auth) → CreateFlow | StudioApp(embedded)
├─ app/login (Telegram Login Widget) · app/privacy · app/terms
└─ app/lab (engineering: deterministic renders, auto-rig, synthetic reconstruction)
```

State: `store/studio.ts` (zustand) — asset, look, history (undo/redo, slider
drags coalesced), category, panel, compare, camera requests, quality tier.
`lib/engine/thumbnails.ts` (thumbnail cache + queue), `lib/account.ts` (plan).
