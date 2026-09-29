"use client";

import { useThree } from "@react-three/fiber";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { BufferGeometry, Float32BufferAttribute, type Texture } from "three";
import { Avatar } from "@/components/three/Avatar";
import { AvatarCanvas } from "@/components/three/AvatarCanvas";
import { StudioStage } from "@/components/three/Stage";
import {
  DEFAULT_LOOK,
  type Look,
  LookSchema,
  applyLookPatch,
  HairstyleId,
  BeardId,
  GlassesId,
  HairColorId,
} from "@/lib/avatar/look";
import type { QualityTier } from "@/lib/engine/protocol";
import { useSceneVersion } from "@/lib/engine/sceneBus";
import { type HeadAsset, TEMPLATE, loadInstantHead, loadTemplateGeometry, loadTemplateHead, loadTexture } from "@/lib/head/asset";
import { reconstructInstantTwin } from "@/lib/recon/reconstruct";
import { syntheticCapture } from "./synthetic";
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
};

function FixedCamera({ view }: { view: string }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(...(VIEWS[view] ?? VIEWS.front));
    camera.lookAt(0, -0.035, 0.01);
    camera.updateProjectionMatrix();
  }, [camera, view]);
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
      const rounded = { ...rig, landmarks: rig.landmarks.map((v) => +v.toFixed(5)), hairline: rig.hairline.map((v) => +v.toFixed(4)) };
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
  const [reconLog, setReconLog] = useState<string[]>([]);
  const [atlasUrl, setAtlasUrl] = useState<string | null>(null);
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const view = q.get("view") ?? "34l";
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
      skin: { tone: q.get("tan") ? "tanned" : "natural", complexion: Number(q.get("cx") ?? 0) },
      accessories: (q.get("acc")?.split(",").filter(Boolean) ?? []) as Look["accessories"],
    });
    return l;
  }, [q]);

  useEffect(() => {
    (async () => {
      const template = await loadTemplateHead();
      if (!recon) return setAsset(template);
      const t0 = performance.now();
      const { frames, log } = await syntheticCapture(template);
      setShots(frames.map((f) => f.image.toDataURL("image/jpeg", 0.7)));
      const record = await reconstructInstantTwin(frames, (p) => setReconLog((l) => [...l.slice(-3), `${(p.progress * 100).toFixed(0)}% ${p.message}`]), {
        persist: false,
      });
      setAtlasUrl(URL.createObjectURL(record.albedo));
      setReconLog((l) => [
        ...log,
        ...l,
        `done in ${((performance.now() - t0) / 1000).toFixed(1)}s · coverage ${(record.coverage * 100).toFixed(0)}%`,
        `face ${record.analysis.faceShape} · L/W ${record.analysis.metrics.lengthToWidth} · IPD ${record.analysis.metrics.ipdMm}mm`,
        `template L/W ${template.analysis.metrics.lengthToWidth}`,
      ]);
      setAsset(await loadInstantHead(record));
    })().catch((e) => {
      window.__ERR__ = String(e);
      console.error(e);
      setReconLog((l) => [...l, `ERROR ${e}`]);
    });
  }, [recon]);
  useEffect(() => {
    if (asset && !busy) {
      const t = setTimeout(() => (window.__READY__ = true), 400);
      return () => clearTimeout(t);
    }
    window.__READY__ = false;
  }, [asset, busy]);

  return (
    <div className="fixed inset-0 bg-[radial-gradient(90%_70%_at_50%_35%,#16171b_0%,#060607_70%)]">
      <AvatarCanvas frameloop="demand">
        <FixedCamera view={view} />
        <Invalidator />
        <StudioStage />
        {asset && (
          <>
            <Avatar asset={asset} look={look} quality={quality} onBusy={setBusy} />
            {q.get("lm") && <Landmarks asset={asset} />}
          </>
        )}
      </AvatarCanvas>
      {recon && (
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
        <pre className="absolute left-3 top-3 max-w-md text-[11px] leading-4 text-mist-300">
          {JSON.stringify(asset.analysis, null, 1)}
        </pre>
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
  return mode === "rig" ? <RigBuilder /> : <LabScene recon={mode === "recon"} />;
}

/** Exposes synthetic selfies as JPEG data URLs for end-to-end upload tests. */
function SynthShots() {
  const [n, setN] = useState(0);
  useEffect(() => {
    (async () => {
      const t = await loadTemplateHead();
      const { frames } = await syntheticCapture(t);
      (window as unknown as { __SHOTS__: string[] }).__SHOTS__ = frames.map((f) => f.image.toDataURL("image/jpeg", 0.92));
      setN(frames.length);
    })().catch((e) => (window.__ERR__ = String(e)));
  }, []);
  return <pre className="p-6 text-mist-200">{n ? `${n} synthetic selfies ready` : "rendering…"}</pre>;
}
