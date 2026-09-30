/// <reference lib="webworker" />
/** Avatar worker: runs the engine core off the main thread (see core.ts). */
import { createAvatarCore } from "@/lib/engine/core";
import type { WorkerRequest } from "@/lib/engine/protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const handle = createAvatarCore((msg, transfer = []) => ctx.postMessage(msg, transfer));
ctx.onmessage = (e: MessageEvent<WorkerRequest>) => handle(e.data);
