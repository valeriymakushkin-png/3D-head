"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Mesh, type Object3D } from "three";
import { isPaid, useAccount, type Plan } from "@/lib/account";
import { stageRef } from "@/lib/engine/stageRef";
import { IconCheck, IconClose, IconCube, IconHd, IconLock } from "@/components/ui/icons";
import { Button, easeOut } from "@/components/ui/primitives";
import { useStudio } from "@/store/studio";
import { openCheckout } from "@/lib/billing/client";

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: React.ReactNode; label: string }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="pointer-events-auto absolute inset-0 z-50 grid place-items-end bg-black/40 md:place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-label={label}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ duration: 0.45, ease: easeOut }}
            onClick={(e) => e.stopPropagation()}
            className="glass relative m-2 w-[calc(100%-16px)] max-w-[520px] rounded-[30px] p-6 md:p-7"
            // Near-opaque: a modal sits over the busy studio UI, and not every WebView blurs.
            style={{ background: "linear-gradient(180deg, rgb(30 27 24 / 0.97), rgb(18 16 14 / 0.97))" }}
          >
            <button onClick={onClose} className="absolute right-4 top-4 text-mist-400 hover:text-mist-100" aria-label="Close">
              <IconClose size={18} />
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** HD still (PNG, up to ~4K) and a real 3D GLB of the twin. */
export function ExportSheet() {
  const open = useStudio((s) => s.panel === "export");
  const openPanel = useStudio((s) => s.openPanel);
  const plan = useAccount((s) => s.account.plan);
  const [busy, setBusy] = useState<string | null>(null);

  const hdStill = async () => {
    if (!isPaid(plan)) return openPanel("paywall");
    const { gl, scene, camera } = stageRef;
    if (!gl || !scene || !camera) return;
    setBusy("still");
    const prev = gl.getPixelRatio();
    const target = Math.min(4, 3840 / gl.domElement.clientWidth);
    gl.setPixelRatio(target);
    gl.render(scene, camera);
    const blob = await new Promise<Blob | null>((r) => gl.domElement.toBlob(r, "image/png"));
    gl.setPixelRatio(prev);
    if (blob) download(blob, "twinme-hd.png");
    setBusy(null);
  };

  const glb = async () => {
    if (!isPaid(plan)) return openPanel("paywall");
    const root = stageRef.scene?.getObjectByName("avatar-main") ?? stageRef.scene?.getObjectByName("avatar-after");
    if (!root) return;
    setBusy("glb");
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const out = exportable(root);
    const data = await new GLTFExporter().parseAsync(out, { binary: true });
    download(new Blob([data as ArrayBuffer], { type: "model/gltf-binary" }), "twinme.glb");
    setBusy(null);
  };

  return (
    <Sheet open={open} onClose={() => openPanel("none")} label="Export">
      <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em]">Export your twin</h3>
      <p className="mt-1 text-[13px] text-mist-400">Exactly what you see, from the current angle.</p>
      <div className="mt-5 grid gap-2.5">
        <ExportRow icon={<IconHd size={20} />} title="HD portrait" sub="PNG · up to 3840 px · studio lighting" locked={!isPaid(plan)} busy={busy === "still"} onClick={hdStill} />
        <ExportRow icon={<IconCube size={20} />} title="3D model" sub="GLB · head, texture, glasses, hair strands" locked={!isPaid(plan)} busy={busy === "glb"} onClick={glb} />
      </div>
    </Sheet>
  );
}

function ExportRow(p: { icon: React.ReactNode; title: string; sub: string; locked: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button onClick={p.onClick} disabled={p.busy} className="glass-soft flex items-center gap-4 rounded-2xl px-4 py-3.5 text-left transition-colors hover:bg-white/[0.07]">
      <span className="grid size-10 place-items-center rounded-xl bg-white/[0.06] text-mist-100">{p.icon}</span>
      <span className="flex-1">
        <span className="block text-[15px] font-medium text-mist-50">{p.title}</span>
        <span className="block text-[12px] text-mist-400">{p.sub}</span>
      </span>
      {p.busy ? <span className="text-shimmer text-[12px]">Rendering…</span> : p.locked ? <IconLock size={16} className="text-mist-500" /> : null}
    </button>
  );
}

/** Converts strand ribbons into glTF line strands; drops helper objects. */
function exportable(root: Object3D): Group {
  const g = new Group();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.visible) return;
    if (m.name === "hair" || m.name === "beard") {
      const src = m.geometry;
      const pos = src.getAttribute("position");
      const attr = src.getAttribute("aHair");
      const idx = src.index!;
      const lines: number[] = [];
      // each quad's first two indices along side 0 form a segment
      for (let i = 0; i < idx.count; i += 6) {
        const a = idx.getX(i),
          b = idx.getX(i + 2);
        if (attr.getY(a) > 0.5) continue;
        lines.push(pos.getX(a), pos.getY(a), pos.getZ(a), pos.getX(b), pos.getY(b), pos.getZ(b));
      }
      const lg = new BufferGeometry();
      lg.setAttribute("position", new BufferAttribute(new Float32Array(lines), 3));
      const mat = m.material as { uniforms?: { uRoot?: { value: { getHex(): number } } } };
      const ls = new LineSegments(lg, new LineBasicMaterial({ color: mat.uniforms?.uRoot?.value.getHex() ?? 0x221a14 }));
      ls.name = m.name;
      g.add(ls);
    } else {
      const c = m.clone();
      c.applyMatrix4(m.matrixWorld);
      g.add(c);
    }
  });
  return g;
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const PLANS: Array<{ id: Exclude<Plan, "free">; name: string; price: string; points: string[] }> = [
  { id: "pro", name: "Pro", price: "$12", points: ["Unlimited transformations", "AI Stylist & custom prompts", "HD export & 3D model"] },
  { id: "barber", name: "Barber", price: "$49", points: ["Client twins & saved cuts", "Consultation mode", "Everything in Pro"] },
  { id: "clinic", name: "Clinic", price: "$199", points: ["Hairline & density simulation", "Patient reports (PDF)", "Everything in Barber"] },
];

export function Paywall() {
  const open = useStudio((s) => s.panel === "paywall");
  const openPanel = useStudio((s) => s.openPanel);
  const [plan, setPlan] = useState<Exclude<Plan, "free">>("pro");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={() => openPanel("none")} label="Upgrade">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-aura-300">TwinMe Pro</p>
      <h3 className="mt-1.5 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em]">Try every look. No limits.</h3>
      <div className="mt-5 grid gap-2">
        {PLANS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPlan(p.id)}
            className={`rounded-2xl border px-4 py-3.5 text-left transition-colors ${plan === p.id ? "border-mist-100/60 bg-white/[0.06]" : "border-white/[0.07] hover:bg-white/[0.04]"}`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-semibold text-mist-50">{p.name}</span>
              <span className="text-[15px] text-mist-100">
                {p.price}
                <span className="text-[12px] text-mist-500">/mo</span>
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {p.points.map((x) => (
                <span key={x} className="flex items-center gap-1 text-[12px] text-mist-400">
                  <IconCheck size={12} className="text-ok-400" />
                  {x}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
      {err && <p className="mt-3 text-[13px] text-err-400">{err}</p>}
      <Button
        variant="solid"
        size="lg"
        className="mt-5 w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          const r = await openCheckout(plan);
          if (!r.ok) setErr(r.message);
          setBusy(false);
        }}
      >
        {busy ? "Opening checkout…" : `Continue with ${PLANS.find((p) => p.id === plan)!.name}`}
      </Button>
      <p className="mt-3 text-center text-[11px] text-mist-500">Cancel anytime. Prices in USD; Telegram purchases use Stars.</p>
    </Sheet>
  );
}
