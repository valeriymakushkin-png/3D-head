import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { BackendUnavailable } from "@/server/db";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const json = <T>(data: T, init?: ResponseInit) => NextResponse.json(data, init);

/** Parses and validates a JSON body with a hard size cap. */
export async function body<S extends z.ZodType>(req: Request, schema: S, maxBytes = 64_000): Promise<z.infer<S>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new HttpError(413, "payload_too_large");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "payload_too_large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "bad_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

/** Wraps a route handler with uniform error mapping (no stack traces leak). */
export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, { status: e.status });
      if (e instanceof BackendUnavailable) return json({ error: "backend_unavailable" }, { status: 503 });
      console.error("[api]", e);
      return json({ error: "internal" }, { status: 500 });
    }
  };
}

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
}
