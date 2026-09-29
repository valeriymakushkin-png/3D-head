# Avatar generation pipeline

Two pipelines produce the same artefact — a **head asset**: a mesh in the
canonical head frame (metres, +Y up, +Z out of the face, +X subject's left,
origin at the cranium centre), a 2K sRGB albedo atlas, a **rig** (478
landmarks + cranium ellipsoid + hairline curve) and a **face analysis**. The
studio does not care which pipeline made it.

## 1. Capture (browser)

`components/capture/GuidedScan.tsx`, `lib/recon/capture.ts`, `lib/recon/poses.ts`

1. `getUserMedia` (front camera, 1280×960 ideal), MediaPipe Face Landmarker in
   `VIDEO` mode every frame → 478 landmarks + facial transformation matrix →
   yaw/pitch/roll (`poseFromMatrix`, yaw > 0 = subject turned to their left).
2. Seven required pose bins (front, ±28°, ±52° yaw, ±16° pitch) + two optional
   profiles (HD). A frame is kept automatically when it lands in an unfilled bin
   and passes gates: angular speed < 30°/s, face height > 28 % of the frame,
   brightness > 58, Laplacian-variance sharpness, then best-score-per-bin.
3. Upload path: EXIF-correct decode (`createImageBitmap(…, {imageOrientation:
   "from-image"})`), detection in `IMAGE` mode, binning; video path samples
   every 150 ms.

## 2. Instant Twin (on-device) — `lib/recon/reconstruct.ts`

| Stage | Module | What happens |
|---|---|---|
| Segment | `analyze.ts` | MediaPipe selfie-multiclass per frame → skin mask (face+body skin), eroded then feathered so seams never land on hair/background edges |
| Fuse | `fusion.ts` | Landmarks → image-space 3D (x, −y, −z·W). Pose-only Horn alignment on 17 rigid points, then 4 rounds of weighted generalised Procrustes; each landmark weighted by how squarely it faces that camera (template normals rotated into the view); frontal view ×1.5 |
| Scale | `fusion.ts` | Iris diameter ≈ 11.7 mm gives metric scale; implausible estimates (closed eyes, glare) fall back to template scale |
| Sculpt | `warp.ts` | Ridge-regularised affine (head proportions) + Gaussian RBF (σ 3 cm) through 468 landmark residuals; depth residuals trusted ×0.5 (MediaPipe z is regressed), residuals capped at 9 mm |
| Cameras | `reconstruct.ts` | Per view: 3×4 affine camera fitted to the fused landmarks (prior = inverse fusion similarity) + a per-vertex 2D residual field (RBF) so every landmark lands on its pixel — this is what makes eyes/lips sharp |
| Bake | `bake.ts` (WebGL2) | Depth pass per photo → UV-space pass accumulating `colour·w` with `w = visible · facing³ · skin · edge · gain`; half-float additive blending; resolve pass fills unseen skin with the template's micro-detail re-coloured to the user's measured skin tone |
| Analyse | `analyze.ts`, `style/analysis.ts` | Face shape (soft distribution over 6 shapes), ITA° skin category + undertone, hair colour (Lab percentiles), length class, density, fringe; beard class from hair-class share + lower-face darkening |
| Persist | `storage.ts` | IndexedDB: 111 KB positions + JPEG atlas + rig + analysis (topology/UVs are the template's) |

Validation (headless, synthetic subject = template scaled 0.93×1.04): recovered
length-to-width 1.315 vs 1.332 expected (−1.3 %), IPD 57.1 mm vs 58.6 mm, fusion
RMS 2.9 mm, 30 s end-to-end under software rendering (phones: 5–15 s).

## 3. HD Twin (GPU) — `services/reconstruct`

1. **Queue.** `/api/avatars` issues one signed upload URL per photo (browser →
   storage directly); `/api/avatars/:id/submit` verifies the files and enqueues.
   The Modal dispatcher (cron + instant trigger) spawns one L4 container per job;
   `claim_reconstruction_job` uses `FOR UPDATE SKIP LOCKED`, leases are kept with
   heartbeats and reclaimed after 15 min.
2. **Frames.** EXIF-transposed decode (HEIC supported), PyAV video sampling,
   MediaPipe landmarks + segmentation, best frame per pose bin.
3. **FLAME fit** (`fitting.py`, PyTorch3D): shared shape β(100); per-view pose,
   translation, focal, expression ψ(50), jaw. Stage 1 rigid from landmarks;
   stage 2 + shape/expression with a soft-silhouette IoU against the skin mask;
   stage 3 + per-vertex albedo and 2nd-order SH lighting per view with a
   Charbonnier photometric loss. Huber landmark loss normalised by face size.
   Rejected if landmark RMS > 6 % of the fit resolution (user-actionable error).
4. **478-landmark rig.** Rays from the fitted frontal camera through all 478
   MediaPipe landmarks into the posed mesh; barycentrics carried to the neutral
   mesh; `rig.py` is a line-by-line port of the web `buildRig`.
5. **Texture** (`texture.py`): texel→(face, bary) map for the FLAME UV layout,
   vertex-splat z-buffer visibility, SH delighting, Laplacian-pyramid multi-band
   blending (sharp high bands from the most frontal views, averaged low bands),
   per-vertex albedo fill, 8 px island padding.
6. **Export**: UV-seam split, PBR GLB with embedded 2K atlas, WebP thumbnail;
   results + metrics written to Postgres, user notified in Telegram.

## 4. Licensing (read before launch)

* **MediaPipe** models and tasks: Apache-2.0 ✅
* **Template head scan** ("Lee Perry-Smith", Infinite-Realities): CC BY 3.0 —
  attribution shipped in the footer and `ATTRIBUTION.md` ✅. Replace with an
  in-house scanned template before scale (roadmap Q2) to own the asset.
* **FLAME** (MPI-IS): research licence; **commercial use requires a paid licence
  (Meshcapade)**. Budget it before enabling HD Twins for paying users. DECA /
  EMOCA / MICA / nvdiffrast were deliberately *not* used (non-commercial).
* **PyTorch3D**: BSD ✅.
