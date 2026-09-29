import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, LookPatchSchema, applyLookPatch, diffLooks } from "./look";

describe("LookPatchSchema", () => {
  it("never injects defaults into a patch", () => {
    const p = LookPatchSchema.parse({ hair: { style: "quiff" } });
    expect(p).toEqual({ hair: { style: "quiff" } });
  });

  it("rejects unknown keys and out-of-range values", () => {
    expect(LookPatchSchema.safeParse({ hair: { style: "mohawk" } }).success).toBe(false);
    expect(LookPatchSchema.safeParse({ hair: { volume: 2 } }).success).toBe(false);
    expect(LookPatchSchema.safeParse({ hat: "fedora" }).success).toBe(false);
  });
});

describe("applyLookPatch", () => {
  it("resets fine-tune sliders when the cut changes, keeps density", () => {
    const tuned = applyLookPatch(DEFAULT_LOOK, { hair: { volume: 0.9, density: 0.6 } });
    const next = applyLookPatch(tuned, { hair: { style: "pompadour" } });
    expect(next.hair.volume).toBeNull();
    expect(next.hair.density).toBe(0.6);
    expect(diffLooks(tuned, next)).toEqual(["hair"]);
  });

  it("clears a custom colour when a named colour is chosen", () => {
    const custom = applyLookPatch(DEFAULT_LOOK, { hair: { customColor: "#123456" } });
    expect(applyLookPatch(custom, { hair: { color: "black" } }).hair.customColor).toBeNull();
  });

  it("dedupes accessories", () => {
    expect(applyLookPatch(DEFAULT_LOOK, { accessories: ["chain", "chain"] }).accessories).toEqual(["chain"]);
  });
});
