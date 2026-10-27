import { describe, it, expect } from "vitest";
import { applyStepUpdates, updateSyntheticsBrowserTestSchema, withoutReadOnlyStepFields } from "../../src/tools/synthetics-browser.js";

const steps = () => [
  { publicId: "aaa-111", name: "Open page", type: "goToUrl", params: { value: "https://x" } },
  { publicId: "bbb-222", name: "Type user", type: "typeText", params: { value: "bob", element: { css: "#u" } } },
  { publicId: "ccc-333", name: "Click login", type: "click", params: {} },
];

describe("applyStepUpdates", () => {
  it("merges params shallowly and keeps other params", () => {
    const { steps: out, changed } = applyStepUpdates(steps(), [{ index: 1, params: { value: "{{ USERNAME }}" } }]);
    expect(out[1].params).toEqual({ value: "{{ USERNAME }}", element: { css: "#u" } });
    expect(changed).toEqual([1]);
  });

  it("finds steps by publicId and sets flags", () => {
    const { steps: out, changed } = applyStepUpdates(steps(), [
      { publicId: "ccc-333", allowFailure: true, timeout: 30 },
    ]);
    expect(out[2]).toMatchObject({ allowFailure: true, timeout: 30 });
    expect(changed).toEqual([2]);
  });

  it("does not mutate the input steps", () => {
    const input = steps();
    applyStepUpdates(input, [{ index: 0, name: "Renamed" }]);
    expect(input[0].name).toBe("Open page");
  });

  it("rejects an update with no index or publicId", () => {
    expect(() => applyStepUpdates(steps(), [{ name: "x" }])).toThrow(/index or a publicId/);
  });

  it("rejects an out-of-range index and an unknown publicId", () => {
    expect(() => applyStepUpdates(steps(), [{ index: 3, name: "x" }])).toThrow(/Step not found/);
    expect(() => applyStepUpdates(steps(), [{ publicId: "nope", name: "x" }])).toThrow(/Step not found/);
  });
});

describe("withoutReadOnlyStepFields", () => {
  it("drops the step publicId that Datadog rejects on update and keeps everything else", () => {
    const step = { publicId: "aaa-111", name: "Open page", type: "goToUrl", allowFailure: true, params: { value: "https://x" } };
    expect(withoutReadOnlyStepFields(step)).toEqual({ name: "Open page", type: "goToUrl", allowFailure: true, params: { value: "https://x" } });
    expect(step.publicId).toBe("aaa-111");
  });
});

describe("update-synthetics-browser-test schema", () => {
  it("defaults dryRun to false", () => {
    expect(updateSyntheticsBrowserTestSchema.parse({ publicId: "abc-def-ghi" }).dryRun).toBe(false);
  });

  it("rejects an empty startUrl or name instead of silently ignoring it", () => {
    expect(updateSyntheticsBrowserTestSchema.safeParse({ publicId: "abc-def-ghi", startUrl: "" }).success).toBe(false);
    expect(updateSyntheticsBrowserTestSchema.safeParse({ publicId: "abc-def-ghi", name: "" }).success).toBe(false);
    expect(updateSyntheticsBrowserTestSchema.safeParse({ publicId: "abc-def-ghi", startUrl: "https://x.test" }).success).toBe(true);
  });
});
