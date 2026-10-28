import { describe, it, expect, vi, beforeEach } from "vitest";

// Handler-level tests with a fake Datadog client. Plain functions, not vi.fn(): see tests/unit/set-status.test.ts.
const fake = vi.hoisted(() => ({
  config: { apiKey: "test-api-key", appKey: "test-app-key", site: "datadoghq.com", allowWrite: true, enabledCategories: null, disabledCategories: null },
  calls: [] as { method: string; arg: any }[],
  test: undefined as any, // what getBrowserTest returns
  variable: undefined as any, // what getGlobalVariable returns
}));

vi.mock("../../src/config.js", () => ({ config: fake.config, validateConfig: () => {} }));
vi.mock("../../src/client.js", () => ({
  syntheticsApi: {
    getBrowserTest: async (arg: any) => { fake.calls.push({ method: "getBrowserTest", arg }); return fake.test; },
    updateBrowserTest: async (arg: any) => { fake.calls.push({ method: "updateBrowserTest", arg }); return { publicId: arg.publicId, steps: arg.body.steps }; },
    createSyntheticsBrowserTest: async (arg: any) => {
      fake.calls.push({ method: "createSyntheticsBrowserTest", arg });
      return { publicId: "new-test-id", name: arg.body.name, status: arg.body.status, steps: arg.body.steps, monitorId: 1 };
    },
    getGlobalVariable: async (arg: any) => { fake.calls.push({ method: "getGlobalVariable", arg }); return fake.variable; },
    editGlobalVariable: async (arg: any) => {
      fake.calls.push({ method: "editGlobalVariable", arg });
      return { id: arg.variableId, ...arg.body };
    },
  },
}));

import {
  createSyntheticsBrowserTest,
  createSyntheticsBrowserTestSchema,
  editSyntheticsGlobalVariable,
  updateSyntheticsBrowserTest,
  updateSyntheticsBrowserTestSchema,
} from "../../src/tools/synthetics-browser.js";

const currentTest = () => ({
  publicId: "kwm-n4j-sqf",
  name: "Pay History Tab.",
  type: "browser",
  status: "live",
  message: "notify @team",
  tags: ["Adminsite", "env:regression"],
  locations: ["aws:us-east-2"],
  options: { tickEvery: 259200, retry: { count: 0, interval: 300 }, deviceIds: ["chrome.laptop_large"], minLocationFailed: 1 },
  config: {
    request: { method: "GET", url: "https://stage.example.test/login" },
    assertions: [],
    variables: [{ name: "TOKEN_VALUE", type: "text" }],
    configVariables: [{ name: "USER", type: "global", id: "gv-1" }],
    setCookie: "a=b",
  },
  steps: [
    { publicId: "step-1", name: "Open page", type: "goToUrl", params: { value: "https://stage.example.test/login" }, allowFailure: false, isCritical: true },
    { publicId: "step-2", name: "Click OK", type: "click", params: { element: { targetOuterHTML: "<button>OK</button>" } }, allowFailure: false, isCritical: true, timeout: 30 },
  ],
});
const withoutIds = (steps: any[]) => steps.map(({ publicId: _id, ...rest }) => rest);
const puts = () => fake.calls.filter((c) => c.method === "updateBrowserTest");
const methods = () => fake.calls.map((c) => c.method);

beforeEach(() => {
  fake.calls.length = 0;
  fake.config.allowWrite = true;
  fake.test = currentTest();
  fake.variable = undefined;
});

describe("updateSyntheticsBrowserTest", () => {
  it("never saves when Datadog returned an empty recording, because the save replaces the whole test", async () => {
    fake.test = { ...currentTest(), steps: [] };
    await expect(updateSyntheticsBrowserTest({ publicId: "kwm-n4j-sqf", tags: ["x"], dryRun: false })).rejects.toThrow(/no steps/);
    expect(puts()).toHaveLength(0);
  });

  it("rejects an empty steps list, even on a dry run, so a recording cannot be wiped", async () => {
    await expect(updateSyntheticsBrowserTest({ publicId: "kwm-n4j-sqf", steps: [], dryRun: false })).rejects.toThrow(/at least one step/);
    await expect(updateSyntheticsBrowserTest({ publicId: "kwm-n4j-sqf", steps: [], dryRun: true })).rejects.toThrow(/at least one step/);
    expect(puts()).toHaveLength(0);
    expect(updateSyntheticsBrowserTestSchema.safeParse({ publicId: "kwm-n4j-sqf", steps: [] }).success).toBe(false);
  });

  it("never saves when the fetched test has no steps field at all", async () => {
    const { steps: _steps, ...noSteps } = currentTest();
    fake.test = noSteps;
    await expect(updateSyntheticsBrowserTest({ publicId: "kwm-n4j-sqf", name: "renamed", dryRun: false })).rejects.toThrow(/no steps/);
    expect(puts()).toHaveLength(0);
  });

  it("saves an empty-recording test only when replacement steps are supplied", async () => {
    fake.test = { ...currentTest(), steps: [] };
    const replacement = [{ type: "goToUrl", name: "Open", params: { value: "https://stage.example.test" } }];
    const result = await updateSyntheticsBrowserTest({ publicId: "kwm-n4j-sqf", steps: replacement, dryRun: false });
    expect(result).toMatchObject({ saved: true, stepCountAfter: 1 });
    expect(puts()).toHaveLength(1);
    expect(puts()[0].arg.body.steps).toEqual(replacement);
  });

  it("dry runs never send a PUT, with or without steps, and need no write permission", async () => {
    fake.config.allowWrite = false;
    const normal = await updateSyntheticsBrowserTest({ publicId: "kwm-n4j-sqf", tags: ["x"], dryRun: true });
    expect(normal).toMatchObject({ dryRun: true, saved: false });

    fake.test = { ...currentTest(), steps: [] };
    const empty = await updateSyntheticsBrowserTest({ publicId: "kwm-n4j-sqf", tags: ["x"], dryRun: true });
    expect(empty).toMatchObject({ dryRun: true, saved: false });
    expect(empty.warning).toMatch(/no steps/);
    expect(puts()).toHaveLength(0);
  });

  it("is blocked without write permission before it talks to Datadog at all", async () => {
    fake.config.allowWrite = false;
    await expect(updateSyntheticsBrowserTest({ publicId: "kwm-n4j-sqf", tags: ["x"], dryRun: false })).rejects.toThrow(/Write operations are disabled/);
    expect(fake.calls).toHaveLength(0);
  });

  it("keeps the recording and the whole configuration when only metadata changes", async () => {
    const before = currentTest();
    await updateSyntheticsBrowserTest({ publicId: "kwm-n4j-sqf", tags: ["new-tag"], dryRun: false });
    expect(puts()).toHaveLength(1);
    const body = puts()[0].arg.body;
    expect(body.tags).toEqual(["new-tag"]);
    expect(body.name).toBe(before.name);
    expect(body.type).toBe(before.type);
    expect(body.status).toBe(before.status);
    expect(body.message).toBe(before.message);
    expect(body.locations).toEqual(before.locations);
    expect(body.options).toEqual(before.options);
    expect(body.config).toEqual(before.config); // request, variables, configVariables and cookie intact
    expect(body.steps).toEqual(withoutIds(before.steps)); // same recording; Datadog rejects the read-only step id
    expect(body.steps.every((s: any) => !("publicId" in s))).toBe(true);
  });

  it("changes only the targeted step and merges its params", async () => {
    const before = currentTest();
    const result = await updateSyntheticsBrowserTest({
      publicId: "kwm-n4j-sqf",
      stepUpdates: [{ publicId: "step-2", allowFailure: true, isCritical: false, params: { extra: 1 } }],
      dryRun: false,
    });
    expect(result.changedStepIndexes).toEqual([1]);
    const steps = puts()[0].arg.body.steps;
    expect(steps[0]).toEqual(withoutIds(before.steps)[0]);
    expect(steps[1]).toMatchObject({ allowFailure: true, isCritical: false, timeout: 30, name: "Click OK" });
    expect(steps[1].params).toEqual({ element: { targetOuterHTML: "<button>OK</button>" }, extra: 1 });
  });

  it("changes the start URL without disturbing the rest of the request", async () => {
    await updateSyntheticsBrowserTest({ publicId: "kwm-n4j-sqf", startUrl: "https://stage.example.test/home", dryRun: false });
    const config = puts()[0].arg.body.config;
    expect(config.request).toEqual({ method: "GET", url: "https://stage.example.test/home" });
    expect(config.configVariables).toEqual(currentTest().config.configVariables);
  });

  it("rejects stepUpdates combined with steps before touching Datadog", async () => {
    await expect(updateSyntheticsBrowserTest({ publicId: "kwm-n4j-sqf", steps: [{ type: "wait" }], stepUpdates: [{ index: 0, name: "x" }], dryRun: false })).rejects.toThrow(/not both/);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("createSyntheticsBrowserTest", () => {
  const input = () => createSyntheticsBrowserTestSchema.parse({
    name: "Throwaway",
    startUrl: "https://www.example.com",
    steps: [{ type: "goToUrl", name: "Open", params: { value: "https://www.example.com" }, publicId: "stale" }, { type: "wait", name: "Wait", params: { value: 5 } }],
  });

  it("a dry run creates nothing and needs no write permission", async () => {
    fake.config.allowWrite = false;
    const result = await createSyntheticsBrowserTest({ ...input(), dryRun: true });
    expect(result).toMatchObject({ dryRun: true, created: false, status: "paused", stepCount: 2 });
    expect(fake.calls).toHaveLength(0);
  });

  it("is blocked without write permission", async () => {
    fake.config.allowWrite = false;
    await expect(createSyntheticsBrowserTest(input())).rejects.toThrow(/Write operations are disabled/);
    expect(fake.calls).toHaveLength(0);
  });

  it("creates the test paused, with the steps and without any step ids", async () => {
    const result = await createSyntheticsBrowserTest(input());
    expect(result).toMatchObject({ created: true, publicId: "new-test-id", status: "paused", stepCount: 2 });
    const body = fake.calls[0].arg.body;
    expect(body).toMatchObject({ name: "Throwaway", type: "browser", status: "paused", locations: ["aws:us-east-2"] });
    expect(body.config.request).toEqual({ method: "GET", url: "https://www.example.com" });
    expect(body.steps.map((s: any) => s.type)).toEqual(["goToUrl", "wait"]);
    expect(body.steps.every((s: any) => !("publicId" in s))).toBe(true);
  });
});

describe("editSyntheticsGlobalVariable", () => {
  const secureVariable = () => ({
    id: "gv-1", name: "SERVICE_PASSWORD", description: "login", tags: ["team:qa"],
    value: { secure: true }, isTotp: false, isFido: false,
  });
  const plainVariable = () => ({
    id: "gv-2", name: "USER_NAME", description: "login name", tags: ["team:qa"],
    value: { secure: false, value: "qa-user" }, isTotp: false, isFido: false,
  });

  it("refuses to edit a secure variable without a new value, because the old one cannot be read back", async () => {
    fake.variable = secureVariable();
    await expect(editSyntheticsGlobalVariable({ variableId: "gv-1", description: "new text" })).rejects.toThrow(/secure/);
    expect(methods()).not.toContain("editGlobalVariable");
  });

  it("sets a new value on a secure variable and keeps it secure with its name and tags", async () => {
    fake.variable = secureVariable();
    const result = await editSyntheticsGlobalVariable({ variableId: "gv-1", value: "n3w-s3cret" });
    expect(result).toMatchObject({ valueUpdated: true, secure: true });
    const body = fake.calls.find((c) => c.method === "editGlobalVariable")!.arg.body;
    expect(body.value).toEqual({ secure: true, value: "n3w-s3cret" });
    expect(body).toMatchObject({ name: "SERVICE_PASSWORD", description: "login", tags: ["team:qa"] });
  });

  it("keeps the current value when only the description or tags change", async () => {
    fake.variable = plainVariable();
    await editSyntheticsGlobalVariable({ variableId: "gv-2", description: "renamed text", tags: ["team:ops"] });
    const body = fake.calls.find((c) => c.method === "editGlobalVariable")!.arg.body;
    expect(body.value).toEqual({ secure: false, value: "qa-user" });
    expect(body).toMatchObject({ name: "USER_NAME", description: "renamed text", tags: ["team:ops"] });
  });

  it("is blocked without write permission before it talks to Datadog at all", async () => {
    fake.config.allowWrite = false;
    fake.variable = plainVariable();
    await expect(editSyntheticsGlobalVariable({ variableId: "gv-2", value: "x" })).rejects.toThrow(/Write operations are disabled/);
    expect(fake.calls).toHaveLength(0);
  });
});
