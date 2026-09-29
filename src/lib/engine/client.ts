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
 */
class AvatarEngine {
  private worker: Worker | null = null;
  private reqId = 0;
  private pending = new Map<number, { resolve: (d: StrandMeshData) => void; reject: (e: Error) => void }>();
  private prepared = new Map<string, Promise<void>>();
  private preparedResolvers = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  private latestByChannel = new Map<string, number>();

  private get w(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./avatar.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
      this.worker.onerror = (e) => {
        for (const [, p] of this.pending) p.reject(new Error(e.message));
        this.pending.clear();
      };
    }
    return this.worker;
  }

  private onMessage(msg: WorkerResponse) {
    if (msg.type === "prepared") {
      this.preparedResolvers.get(msg.headId)?.resolve();
      this.preparedResolvers.delete(msg.headId);
      if (process.env.NODE_ENV !== "production") {
        console.info(`[engine] prepared ${msg.headId} in ${msg.ms.toFixed(0)}ms (${msg.scalpRoots} roots, ${msg.faceSamples} face samples)`);
      }
    } else if (msg.type === "strands") {
      const p = this.pending.get(msg.reqId);
      this.pending.delete(msg.reqId);
      p?.resolve(msg.data);
    } else if (msg.type === "error") {
      if (msg.reqId !== undefined) {
        this.pending.get(msg.reqId)?.reject(new Error(msg.message));
        this.pending.delete(msg.reqId);
      } else {
        this.preparedResolvers.get(msg.headId)?.reject(new Error(msg.message));
        this.preparedResolvers.delete(msg.headId);
        this.prepared.delete(msg.headId);
      }
    }
  }

  prepare(headId: string, geometry: BufferGeometry, rig: HeadRig, quality: QualityTier): Promise<void> {
    const existing = this.prepared.get(headId);
    if (existing) return existing;
    const pos = geometry.getAttribute("position").array as Float32Array;
    const nrm = geometry.getAttribute("normal").array as Float32Array;
    const idx = geometry.index!.array;
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
    this.w.postMessage(msg, [msg.positions.buffer, msg.normals.buffer, msg.index.buffer]);
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
      const msg =
        kind === "hair"
          ? ({ type: "hair", headId, reqId, params: params as HairParams, seed, quality } as const)
          : ({ type: "beard", headId, reqId, params: params as BeardParams, seed, quality } as const);
      this.w.postMessage(msg);
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
    this.worker?.postMessage({ type: "dispose", headId } satisfies WorkerRequest);
  }
}

export const avatarEngine = typeof window === "undefined" ? (null as unknown as AvatarEngine) : new AvatarEngine();
