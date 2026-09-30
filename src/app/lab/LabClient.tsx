"use client";

import { useThree } from "@react-three/fiber";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AgXToneMapping, BufferGeometry, Float32BufferAttribute, type Mesh, Mesh as ThreeMesh, MeshStandardMaterial, NeutralToneMapping, type Texture } from "three";
import { Avatar } from "@/components/three/Avatar";
import { AvatarCanvas } from "@/components/three/AvatarCanvas";
import { StudioStage } from "@/components/three/Stage";
import { DEFAULT_LOOK, type Look, LookSchema, applyLookPatch, HairstyleId, BeardId, GlassesId, HairColorId } from "@/lib/avatar/look";
import type { QualityTier } from "@/lib/engine/protocol";
import { avatarEngine } from "@/lib/engine/client";
import { HAIRSTYLE_PRESETS, resolveBeardParams, resolveHairColor, resolveHairParams } from "@/lib/hair/params";
import { writeMasks } from "@/lib/three/masks";
import { useSceneVersion } from "@/lib/engine/sceneBus";
import { type HeadAsset, TEMPLATE, loadInstantHead, loadTemplateGeometry, loadTemplateHead, loadTexture } from "@/lib/head/asset";
import { reconstructInstantTwin } from "@/lib/recon/reconstruct";
import { framesFromPhotos } from "@/lib/recon/capture";
import { SYNTH_SCALE, syntheticCapture, syntheticScanVideo } from "./synthetic";
import { applySimilarity, similarityAlign } from "@/lib/recon/linalg";
import { fuseLandmarks } from "@/lib/recon/fusion";
import { templateLandmarkNormals } from "@/lib/recon/reconstruct";
import { type GtHead, gtError, loadGtHead } from "./gtHead";
import { buildRig } from "@/lib/head/rig";
import { autoRigMesh } from "@/lib/recon/autorig";

declare global {
  interface Window {
    __RIG__?: unknown;
    __READY__?: boolean;
    __ERR__?: string;
  }
}

const VIEWS: Record<string, [number, number, number]> = {
  front: [0, 0.01, 0.86],
  left: [0.86, 0.01, 0],
  right: [-0.86, 0.01, 0],
  back: [0, 0.05, -0.86],
  "34l": [0.6, 0.06, 0.62],
  "34r": [-0.6, 0.06, 0.62],
  top: [0, 0.8, 0.35],
  close: [0.12, 0.0, 0.42],
  /** Slightly above eye level, 3/4 left — used for the landing look renders. */
  hero: [0.56, 0.2, 0.68],
};

function FixedCamera({ view }: { view: string }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    camera.position.set(...(VIEWS[view] ?? VIEWS.front));
    camera.lookAt(0, -0.035, 0.01);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, view, invalidate]);
  return null;
}

/** Demand-mode renderer: repaint whenever the scene bus bumps. */
function Invalidator() {
  const invalidate = useThree((s) => s.invalidate);
  const version = useSceneVersion((s) => s.version);
  useEffect(() => {
    invalidate();
    const t = setTimeout(() => invalidate(), 250);
    return () => clearTimeout(t);
  }, [version, invalidate]);
  return null;
}

function Landmarks({ asset }: { asset: HeadAsset }) {
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(asset.rig.landmarks, 3));
    return g;
  }, [asset]);
  return (
    <points geometry={geo}>
      <pointsMaterial size={0.0025} color="#7df" depthTest={false} />
    </points>
  );
}

function RigBuilder() {
  const [status, setStatus] = useState("building rig…");
  useEffect(() => {
    (async () => {
      const [geometry, albedo] = await Promise.all([loadTemplateGeometry(), loadTexture(TEMPLATE.albedo, true, true)]);
      const lms = await autoRigMesh(geometry, albedo as Texture);
      const rig = buildRig(lms, geometry.getAttribute("position").array);
      const rounded = {
        ...rig,
        landmarks: rig.landmarks.map((v) => +v.toFixed(5)),
        hairline: rig.hairline.map((v) => +v.toFixed(4)),
      };
      window.__RIG__ = rounded;
      setStatus(`rig ready: ${rig.landmarks.length / 3} landmarks, radii ${rig.radii.map((r) => r.toFixed(3)).join(", ")}`);
    })().catch((e) => {
      window.__ERR__ = String(e);
      setStatus(`error: ${e}`);
    });
  }, []);
  return <pre className="p-6 text-sm text-mist-200">{status}</pre>;
}

function LabScene({ recon = false }: { recon?: boolean }) {
  const q = useSearchParams();
  const [asset, setAsset] = useState<HeadAsset | null>(null);
  const [gtMesh, setGtMesh] = useState<Mesh | null>(null);
  const [show, setShow] = useState(q.get("show") ?? "twin");
  const [reconLog, setReconLog] = useState<string[]>([]);
  const [atlasUrl, setAtlasUrl] = useState<string | null>(null);
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [view, setView] = useState(q.get("view") ?? "34l");
  // Test harnesses shoot several angles of one reconstruction: window.__SETVIEW__("left").
  useEffect(() => {
    (window as unknown as { __SETVIEW__?: (v: string) => void }).__SETVIEW__ = setView;
    (window as unknown as { __SETSHOW__?: (v: string) => void }).__SETSHOW__ = setShow;
  }, []);
  const quality = (q.get("q") ?? "high") as QualityTier;
  const look: Look = useMemo(() => {
    let l = LookSchema.parse(DEFAULT_LOOK);
    const hs = HairstyleId.safeParse(q.get("hair"));
    const bd = BeardId.safeParse(q.get("beard"));
    const gl = GlassesId.safeParse(q.get("glasses"));
    const hc = HairColorId.safeParse(q.get("color"));
    l = applyLookPatch(l, {
      hair: {
        ...(hs.success ? { style: hs.data } : {}),
        ...(hc.success ? { color: hc.data } : {}),
        ...(q.get("len") ? { length: Number(q.get("len")) } : {}),
        ...(q.get("vol") ? { volume: Number(q.get("vol")) } : {}),
        ...(q.get("tex") ? { texture: Number(q.get("tex")) } : {}),
        ...(q.get("rec") ? { recession: Number(q.get("rec")) } : {}),
      },
      beard: bd.success ? { style: bd.data } : undefined,
      glasses: gl.success ? { style: gl.data } : undefined,
      skin: {
        tone: q.get("tan") ? "tanned" : "natural",
        complexion: Number(q.get("cx") ?? 0),
      },
      accessories: (q.get("acc")?.split(",").filter(Boolean) ?? []) as Look["accessories"],
    });
    return l;
  }, [q]);

  useEffect(() => {
    (async () => {
      // /lab?nat={"shape":{…}}: try a natural-hair measurement on any head.
      const nat = q.get("nat") ? (JSON.parse(q.get("nat")!) as Partial<HeadAsset["natural"]>) : null;
      const withNat = (a: HeadAsset): HeadAsset => (nat ? { ...a, natural: { ...a.natural, ...nat } } : a);
      const template = await loadTemplateHead();
      if (!recon) return setAsset(withNat(template));
      const t0 = performance.now();
      // /lab?mode=recon&src=photos: real photos injected by a test harness as
      // window.__PHOTOS__ (data URLs), through the same import path as uploads.
      // /lab?mode=recon&src=gt: a real scanned head (window.__GTGLB__ / __GTTEX__ data
      // URLs) → synthetic selfie session → twin, scored against the scan itself.
      let gt: GtHead | null = null;
      if (q.get("src") === "gt") {
        const w = window as unknown as {
          __GTGLB__?: string;
          __GTTEX__?: string;
        };
        while (!w.__GTGLB__ || !w.__GTTEX__) await new Promise((r) => setTimeout(r, 100));
        gt = await loadGtHead(w.__GTGLB__, w.__GTTEX__, template, q.get("morph") ? JSON.parse(q.get("morph")!) : {});
        setGtMesh(gt.mesh);
      }
      const { frames, log } = gt
        ? await syntheticCapture(template, gt.mesh)
        : q.get("src") === "photos"
          ? await (async () => {
              const w = window as unknown as { __PHOTOS__?: string[] };
              while (!w.__PHOTOS__) await new Promise((r) => setTimeout(r, 100));
              const files = await Promise.all(
                w.__PHOTOS__.map(
                  async (u, i) =>
                    new File([await (await fetch(u)).blob()], `photo${i}.jpg`, {
                      type: "image/jpeg",
                    }),
                ),
              );
              const r = await framesFromPhotos(files);
              return {
                frames: r.frames,
                log: [
                  `${r.frames.length} photos, rejected: ${r.rejected.join(", ") || "none"}`,
                  ...r.frames.map((f) => `yaw ${f.pose.yaw.toFixed(1)} pitch ${f.pose.pitch.toFixed(1)}`),
                ],
              };
            })()
          : await syntheticCapture(template);
      setShots(frames.map((f) => f.image.toDataURL("image/jpeg", 0.7)));
      const record = await reconstructInstantTwin(frames, (p) => setReconLog((l) => [...l.slice(-3), `${(p.progress * 100).toFixed(0)}% ${p.message}`]), {
        persist: false,
      });
      setAtlasUrl(URL.createObjectURL(record.albedo));
      (window as unknown as { __RECORD__?: unknown }).__RECORD__ = record;
      setReconLog((l) => [
        ...log,
        ...l,
        `done in ${((performance.now() - t0) / 1000).toFixed(1)}s · coverage ${(record.coverage * 100).toFixed(0)}%`,
        `face ${record.analysis.faceShape} · L/W ${record.analysis.metrics.lengthToWidth} · IPD ${record.analysis.metrics.ipdMm}mm`,
        `template L/W ${template.analysis.metrics.lengthToWidth}`,
        ...(gt
          ? [gtError(record.positions, record.rig.landmarks, gt)]
          : q.get("src") === "photos"
            ? []
            : [groundTruthError(record.positions, record.rig.landmarks, template)]),
      ]);
      if (gt) console.info("[likeness] " + gtError(record.positions, record.rig.landmarks, gt));
      setAsset(withNat(await loadInstantHead(record)));
    })().catch((e) => {
      window.__ERR__ = String(e);
      console.error(e);
      setReconLog((l) => [...l, `ERROR ${e}`]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recon]);
  useEffect(() => {
    if (asset && !busy) {
      const t = setTimeout(() => (window.__READY__ = true), 400);
      return () => clearTimeout(t);
    }
    window.__READY__ = false;
  }, [asset, busy]);

  return (
    <div className="fixed inset-0 bg-[radial-gradient(90%_70%_at_50%_35%,#2a241f_0%,#0b0a09_75%)]">
      <AvatarCanvas
        frameloop="demand"
        onCreated={({ gl }) => {
          // A/B tone mapping for visual QA: /lab?tm=agx
          gl.toneMapping = q.get("tm") === "agx" ? AgXToneMapping : NeutralToneMapping;
          gl.toneMappingExposure = Number(q.get("exp") ?? 1);
        }}
      >
        <FixedCamera view={view} />
        <Invalidator />
        <StudioStage />
        {gtMesh && show === "gt" ? (
          <primitive object={gtMesh} />
        ) : (
          asset && (
            <>
              <Avatar asset={asset} look={look} quality={quality} onBusy={setBusy} />
              {q.get("lm") && <Landmarks asset={asset} />}
            </>
          )
        )}
      </AvatarCanvas>
      {recon && !q.get("clean") && (
        <div className="absolute left-3 top-3 flex max-w-[48%] flex-col gap-2 text-[11px] leading-4 text-mist-300">
          <div className="flex flex-wrap gap-1">
            {shots.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt="" className="h-20 rounded" />
            ))}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {atlasUrl && <img src={atlasUrl} alt="atlas" className="h-40 w-40 rounded" />}
          <pre className="whitespace-pre-wrap">{reconLog.join("\n")}</pre>
        </div>
      )}
      {asset && q.get("info") && (
        <pre className="absolute left-3 top-3 max-w-md text-[11px] leading-4 text-mist-300">{JSON.stringify(asset.analysis, null, 1)}</pre>
      )}
    </div>
  );
}

export function LabClient() {
  return (
    <Suspense>
      <LabRouter />
    </Suspense>
  );
}

function LabRouter() {
  const q = useSearchParams();
  const mode = q.get("mode");
  if (mode === "synth") return <SynthShots />;
  if (mode === "calib") return <Calibrate />;
  if (mode === "export") return <ExportDump />;
  return mode === "rig" ? <RigBuilder /> : <LabScene recon={mode === "recon"} />;
}

/** Exposes synthetic selfies as JPEG data URLs for end-to-end upload tests. */
function SynthShots() {
  const [n, setN] = useState(0);
  useEffect(() => {
    (async () => {
      const t = await loadTemplateHead();
      if (new URLSearchParams(window.location.search).has("video")) {
        const v = syntheticScanVideo(t);
        (window as unknown as { __VIDEO__: typeof v }).__VIDEO__ = v;
        setN(v.frames.length);
        return;
      }
      const { frames } = await syntheticCapture(t);
      (window as unknown as { __SHOTS__: string[] }).__SHOTS__ = frames.map((f) => f.image.toDataURL("image/jpeg", 0.92));
      setN(frames.length);
    })().catch((e) => (window.__ERR__ = String(e)));
  }, []);
  return <pre className="p-6 text-mist-200">{n ? `${n} synthetic frames ready` : "rendering…"}</pre>;
}

/**
 * Offline-render export: the template head (engine space, metres) and the hair
 * / beard strands of a look as centre-line polylines, for the Blender Cycles
 * renders used on the landing page. Exposed as window.__EXPORT__ (base64).
 */
function ExportDump() {
  const q = useSearchParams();
  const [status, setStatus] = useState("exporting…");
  useEffect(() => {
    (async () => {
      const asset = await loadTemplateHead();
      const hs = HairstyleId.safeParse(q.get("hair"));
      const bd = BeardId.safeParse(q.get("beard"));
      const look = applyLookPatch(LookSchema.parse(DEFAULT_LOOK), {
        hair: {
          ...(hs.success ? { style: hs.data } : {}),
          ...(q.get("len") ? { length: Number(q.get("len")) } : {}),
          ...(q.get("vol") ? { volume: Number(q.get("vol")) } : {}),
          ...(q.get("tex") ? { texture: Number(q.get("tex")) } : {}),
        },
        beard: bd.success ? { style: bd.data } : undefined,
      });
      const quality = (q.get("q") ?? "ultra") as QualityTier;
      const b64 = (a: ArrayBufferView) => {
        const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        let out = "";
        for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return btoa(out);
      };
      const strands = (d: Awaited<ReturnType<typeof avatarEngine.hair>>) => {
        if (!d) return null;
        const S = d.strandCount,
          K = d.pointsPerStrand;
        // Ribbons carry two vertices per point that share the centre line.
        const pts = new Float32Array(S * K * 3);
        const rnd = new Uint8Array(S);
        for (let s = 0; s < S; s++) {
          rnd[s] = d.attr[s * K * 2 * 4 + 2];
          for (let k = 0; k < K; k++) pts.set(d.position.subarray((s * K + k) * 2 * 3, (s * K + k) * 2 * 3 + 3), (s * K + k) * 3);
        }
        return { S, K, width: d.strandWidth, points: b64(pts), rnd: b64(rnd) };
      };
      const hairParams = resolveHairParams(look.hair, asset.natural);
      const beardParams = resolveBeardParams(look.beard);
      const hair = hairParams ? await avatarEngine.hair("export", asset, hairParams, quality) : null;
      const beard = beardParams ? await avatarEngine.beard("export", asset, beardParams, quality) : null;
      const g = asset.geometry;
      // Per-vertex skin masks for this look: beard shadow, beard zone, scalp coverage, features.
      const mask = new Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 4), 4);
      writeMasks(mask, g.getAttribute("position").array, asset.rig, asset.statics, hairParams, beardParams);
      // Whole scalp (what a buzz cut covers): faded areas still read as scalp, not bare skin.
      const scalpArea = new Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 4), 4);
      writeMasks(scalpArea, g.getAttribute("position").array, asset.rig, asset.statics, HAIRSTYLE_PRESETS.buzz_cut, null);
      (window as unknown as { __EXPORT__: unknown }).__EXPORT__ = {
        head: {
          mask: b64(mask.array as Float32Array),
          scalp: b64(Float32Array.from({ length: scalpArea.count }, (_, i) => (scalpArea.array as Float32Array)[i * 4 + 2])),
          position: b64(g.getAttribute("position").array as Float32Array),
          uv: b64(g.getAttribute("uv").array as Float32Array),
          index: b64(Uint32Array.from(g.index!.array)),
        },
        rig: asset.rig,
        hairColor: resolveHairColor(look.hair, asset.natural),
        hair: strands(hair),
        beard: strands(beard),
      };
      setStatus(`exported ${hair?.strandCount ?? 0} hair strands, ${beard?.strandCount ?? 0} beard strands`);
    })().catch((e) => {
      window.__ERR__ = String(e);
      setStatus(`error: ${e}`);
    });
  }, [q]);
  return <pre className="p-6 text-sm text-mist-200">{status}</pre>;
}

/**
 * Synthetic scans have a known answer (the template scaled by SYNTH_SCALE):
 * shape error after a similarity fit, and the face's width/length ratio.
 */
function groundTruthError(positions: Float32Array, landmarks: ArrayLike<number>, template: HeadAsset): string {
  const tp = template.geometry.getAttribute("position").array as Float32Array;
  const gt = new Float64Array(tp.length);
  for (let i = 0; i < tp.length; i += 3) {
    gt[i] = tp[i] * SYNTH_SCALE[0];
    gt[i + 1] = tp[i + 1] * SYNTH_SCALE[1];
    gt[i + 2] = tp[i + 2] * SYNTH_SCALE[2];
  }
  const sim = similarityAlign(positions, gt);
  const al = applySimilarity(sim, positions);
  let all = 0,
    face = 0,
    nf = 0;
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const d2 = (al[i * 3] - gt[i * 3]) ** 2 + (al[i * 3 + 1] - gt[i * 3 + 1]) ** 2 + (al[i * 3 + 2] - gt[i * 3 + 2]) ** 2;
    all += d2;
    if (gt[i * 3 + 2] > 0.03) {
      face += d2;
      nf++;
    }
  }
  const T = template.rig.landmarks;
  const dist = (L: ArrayLike<number>, a: number, b: number, sc: readonly number[] = [1, 1, 1]) =>
    Math.hypot((L[a * 3] - L[b * 3]) * sc[0], (L[a * 3 + 1] - L[b * 3 + 1]) * sc[1], (L[a * 3 + 2] - L[b * 3 + 2]) * sc[2]);
  const ratio = (L: ArrayLike<number>, sc?: readonly number[]) => (dist(L, 234, 454, sc) / dist(L, 10, 152, sc)).toFixed(3);
  const jaw = (L: ArrayLike<number>, sc?: readonly number[]) => (dist(L, 172, 397, sc) / dist(L, 10, 152, sc)).toFixed(3);
  return `GT rms ${(Math.sqrt(all / n) * 1000).toFixed(2)}mm · face ${(Math.sqrt(face / Math.max(1, nf)) * 1000).toFixed(2)}mm · W/L ${ratio(landmarks)} (gt ${ratio(T, SYNTH_SCALE)}) · jaw/L ${jaw(landmarks)} (gt ${jaw(T, SYNTH_SCALE)})`;
}

/**
 * Template landmark calibration: the template itself goes through the same
 * selfie session + fusion as a user (at a few arm's-length distances), and the
 * averaged result becomes the template's `fitLandmarks`. The sculpting step then
 * compares like with like — a jaw contour measured from seven close views is
 * not where a straight-on telephoto render puts it, and that difference used to
 * come out as every twin's jaw being too narrow.
 */
function Calibrate() {
  const [status, setStatus] = useState("calibrating…");
  useEffect(() => {
    (async () => {
      const template = await loadTemplateHead();
      const head = new MeshStandardMaterial({ map: template.albedo, roughness: 0.6 });
      const mesh = new ThreeMesh(template.geometry.clone(), head);
      const T = template.rig.landmarks;
      const normals = templateLandmarkNormals(template);
      const acc = new Float64Array(478 * 3);
      const dists = [0.3, 0.34, 0.4];
      const lines: string[] = [];
      for (const d of dists) {
        const { frames } = await syntheticCapture(template, mesh, d);
        const fusion = fuseLandmarks(
          frames.map((f) => ({ landmarks: f.landmarks, width: f.width, height: f.height, yaw: f.pose.yaw })),
          T,
          normals,
        );
        // fused is anchored to the template frame by a similarity already
        for (let i = 0; i < acc.length; i++) acc[i] += fusion.fused[i] / dists.length;
        const dd = (P: ArrayLike<number>, a: number, b: number) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
        lines.push(`${d} m: ${frames.length} views · jaw ${(dd(fusion.fused, 172, 397) * 1000).toFixed(1)} mm (rig ${(dd(T, 172, 397) * 1000).toFixed(1)}) · face ${(dd(fusion.fused, 234, 454) * 1000).toFixed(1)} mm (rig ${(dd(T, 234, 454) * 1000).toFixed(1)})`);
      }
      (window as unknown as { __CALIB__?: number[] }).__CALIB__ = Array.from(acc, (v) => +v.toFixed(6));
      setStatus(lines.join("\n"));
    })().catch((e) => {
      window.__ERR__ = String(e);
      setStatus(`error: ${e}`);
    });
  }, []);
  return <pre className="p-6 text-sm text-mist-200">{status}</pre>;
}
