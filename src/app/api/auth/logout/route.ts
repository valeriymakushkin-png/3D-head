import { json, route } from "@/server/http";
import { clearSession } from "@/server/session";

export const runtime = "nodejs";

export const POST = route(async () => {
  await clearSession();
  return json({ ok: true });
});
