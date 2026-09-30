"use client";

import type { BufferGeometry } from "three";
import type { StrandMeshData } from "@/lib/hair/generate";
import type { BeardParams, HairParams } from "@/lib/hair/params";
import type { HeadRig } from "@/lib/head/rig";
import type { QualityTier, WorkerRequest, WorkerResponse } from "@/lib/engine/protocol";

export interface PreparableHead {
  id: string;
  geometry: BufferGeometry;
  rig: HeadRig;
}

/**
 * Main-thread facade for the avatar worker. Requests are grouped into
 * channels ("main", "compare", "thumb") with latest-wins semantics, so
 * scrubbing a slider only ever renders the newest result.
 *
 * Failure is never silent: if the worker can't start (or hangs while
 * preparing a head), the same engine core is loaded in-thread and every
 * outstanding request is replayed there.
 */
class AvatarEngine {
  private worker: Worker | null = null;
  private mode: "idle" | "worker" | "loading-local" | "local" = "idle";
  private local: ((msg: WorkerRequest) => void) | null = null;
  private queue: WorkerRequest[] = [];
  private reqId = 0;
  private pending = new Map<number, { resolve: (d: StrandMeshData) => void; reject: (e: Error) => void }>();
  /** Kept for replay if we have to fall back to the in-thread core. */
  private prepareMsgs = new Map<string, WorkerRequest>();
  private requestMsgs = new Map<number, WorkerRequest>();
  private prepared = new Map<string, Promise<void>>();
  private preparedResolvers = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  private watchdogs = new Map<string, ReturnType<typeof setTimeout>>();
  private latestByChannel = new Map<string, number>();

  private send(msg: WorkerRequest) {
    if (this.mode === "idle") this.startWorker();
    if (this.mode === "worker") {
      this.worker!.postMessage(msg);
      if (msg.type === "prepare") {
        // A worker that never answers is as bad as one that fails to load.
        this.watchdogs.set(
          msg.headId,
          setTimeout(() => this.preparedResolvers.has(msg.headId) && this.fallBack("prepare timed out"), 20_000),
        );
      }
    } else if (this.mode === "local") {
      const run = this.local!;
      setTimeout(() => run(msg), 0);
    } else if (!this.queue.includes(msg)) {
      // Loading the fallback: fallBack() already queued every outstanding message.
      this.queue.push(msg);
    }
  }

  private startWorker() {
    try {
      const w = new Worker(new URL("./avatar.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
      w.onerror = (e) => {
        e.preventDefault?.();
        this.fallBack(e.message || "worker error");
      };
      w.onmessageerror = () => this.fallBack("worker message error");
      this.worker = w;
      this.mode = "worker";
    } catch (e) {
      this.fallBack(e instanceof Error ? e.message : String(e));
    }
  }

  private fallBack(reason: string) {
    if (this.mode === "local" || this.mode === "loading-local") return;
    console.warn(`[engine] worker unavailable (${reason}); generating on the main thread`);
    this.worker?.terminate();
    this.worker = null;
    for (const t of this.watchdogs.values()) clearTimeout(t);
    this.watchdogs.clear();
    this.mode = "loading-local";
    // Heads prepared in the dead worker must be prepared again, then pending requests re-run.
    this.queue = [...this.prepareMsgs.values(), ...this.requestMsgs.values()];
    import("@/lib/engine/core")
      .then(({ createAvatarCore }) => {
        this.local = createAvatarCore((m) => this.onMessage(m));
        this.mode = "local";
        const queued = this.queue;
        this.queue = [];
        for (const m of queued) this.send(m);
      })
      .catch((e) => {
        const err = new Error(`avatar engine unavailable: ${e instanceof Error ? e.message : e}`);
        for (const [, p] of this.preparedResolvers) p.reject(err);
        for (const [, p] of this.pending) p.reject(err);
        this.preparedResolvers.clear();
        this.pending.clear();
      });
  }

  private onMessage(msg: WorkerResponse) {
    if (msg.type === "prepared") {
      clearTimeout(this.watchdogs.get(msg.headId));
      this.watchdogs.delete(msg.headId);
      this.preparedResolvers.get(msg.headId)?.resolve();
      this.preparedResolvers.delete(msg.headId);
      if (process.env.NODE_ENV !== "production") {
        console.info(`[engine] prepared ${msg.headId} in ${msg.ms.toFixed(0)}ms (${msg.scalpRoots} roots, ${msg.faceSamples} face samples)`);
      }
    } else if (msg.type === "strands") {
      const p = this.pending.get(msg.reqId);
      this.pending.delete(msg.reqId);
      this.requestMsgs.delete(msg.reqId);
      p?.resolve(msg.data);
    } else if (msg.type === "error") {
      if (msg.reqId !== undefined) {
        this.pending.get(msg.reqId)?.reject(new Error(msg.message));
        this.pending.delete(msg.reqId);
        this.requestMsgs.delete(msg.reqId);
      } else {
        clearTimeout(this.watchdogs.get(msg.headId));
        this.watchdogs.delete(msg.headId);
        this.preparedResolvers.get(msg.headId)?.reject(new Error(msg.message));
        this.preparedResolvers.delete(msg.headId);
        this.prepared.delete(msg.headId);
        this.prepareMsgs.delete(msg.headId);
      }
    }
  }

  prepare(headId: string, geometry: BufferGeometry, rig: HeadRig, quality: QualityTier): Promise<void> {
    const existing = this.prepared.get(headId);
    if (existing) return existing;
    const pos = geometry.getAttribute("position").array as Float32Array;
    const nrm = geometry.getAttribute("normal").array as Float32Array;
    const idx = geometry.index!.array;
    // Copied, not transferred: the message is kept for replay (a few hundred KB per head).
    const msg: WorkerRequest = {
      type: "prepare",
      headId,
      positions: new Float32Array(pos),
      normals: new Float32Array(nrm),
      index: Uint32Array.from(idx),
      rig,
      quality,
    };
    const promise = new Promise<void>((resolve, reject) => this.preparedResolvers.set(headId, { resolve, reject }));
    this.prepared.set(headId, promise);
    this.prepareMsgs.set(headId, msg);
    this.send(msg);
    return promise;
  }

  private request(
    kind: "hair" | "beard",
    channel: string,
    headId: string,
    params: HairParams | BeardParams,
    quality: QualityTier,
    seed: number,
  ): Promise<StrandMeshData | null> {
    const reqId = ++this.reqId;
    this.latestByChannel.set(channel, reqId);
    return new Promise<StrandMeshData>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      const msg: WorkerRequest =
        kind === "hair"
          ? { type: "hair", headId, reqId, params: params as HairParams, seed, quality }
          : { type: "beard", headId, reqId, params: params as BeardParams, seed, quality };
      this.requestMsgs.set(reqId, msg);
      this.send(msg);
    }).then((data) => (this.latestByChannel.get(channel) === reqId ? data : null));
  }

  async hair(channel: string, head: PreparableHead, params: HairParams, quality: QualityTier, seed = 1) {
    await this.prepare(head.id, head.geometry, head.rig, quality);
    return this.request("hair", `${channel}:hair`, head.id, params, quality, seed);
  }

  async beard(channel: string, head: PreparableHead, params: BeardParams, quality: QualityTier, seed = 2) {
    await this.prepare(head.id, head.geometry, head.rig, quality);
    return this.request("beard", `${channel}:beard`, head.id, params, quality, seed);
  }

  dispose(headId: string) {
    this.prepared.delete(headId);
    this.prepareMsgs.delete(headId);
    if (this.mode !== "idle") this.send({ type: "dispose", headId });
  }
}

export const avatarEngine = typeof window === "undefined" ? (null as unknown as AvatarEngine) : new AvatarEngine();
