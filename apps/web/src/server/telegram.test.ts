import { createHash, createHmac } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const TOKEN = "123456:ABCdefGhIJKlmNoPQRstuVWXyz0123456789ab";

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
});

function signInitData(fields: Record<string, string>) {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", key).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

describe("verifyInitData", () => {
  it("accepts a correctly signed, fresh payload", async () => {
    const { verifyInitData } = await import("./telegram");
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "AAE",
      user: JSON.stringify({ id: 42, first_name: "Ada" }),
    });
    const r = verifyInitData(initData);
    expect(r?.user.id).toBe(42);
  });

  it("rejects tampered data", async () => {
    const { verifyInitData } = await import("./telegram");
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42, first_name: "Ada" }) });
    expect(verifyInitData(initData.replace("42", "43"))).toBeNull();
  });

  it("rejects stale data", async () => {
    const { verifyInitData } = await import("./telegram");
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000) - 90_000), user: JSON.stringify({ id: 1, first_name: "A" }) });
    expect(verifyInitData(initData)).toBeNull();
  });
});

describe("verifyLoginWidget", () => {
  it("accepts widget data signed with SHA256(token)", async () => {
    const { verifyLoginWidget } = await import("./telegram");
    const data: Record<string, string> = { id: "7", first_name: "Linus", auth_date: String(Math.floor(Date.now() / 1000)) };
    const dcs = Object.keys(data)
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join("\n");
    data.hash = createHmac("sha256", createHash("sha256").update(TOKEN).digest()).update(dcs).digest("hex");
    expect(verifyLoginWidget(data)?.id).toBe(7);
    expect(verifyLoginWidget({ ...data, first_name: "Mallory" })).toBeNull();
  });
});

describe("invoice payload", () => {
  it("round-trips and rejects junk", async () => {
    const { encodeInvoicePayload, decodeInvoicePayload } = await import("./telegram");
    const id = "0b5c1a9e-6f3b-4c1d-9a2b-3c4d5e6f7a8b";
    expect(decodeInvoicePayload(encodeInvoicePayload(id, "pro"))).toEqual({ plan: "pro", userId: id });
    expect(decodeInvoicePayload("v1:free:" + id)).toBeNull();
  });
});
