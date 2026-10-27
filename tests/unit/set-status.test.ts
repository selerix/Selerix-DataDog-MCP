import { describe, it, expect, vi, beforeEach } from "vitest";

// A plain fake instead of vi.fn(): the Datadog call must be able to reject without the spy's call tracking
// reporting that rejection to the runner as an unhandled error.
const fake = vi.hoisted(() => ({
  calls: [] as unknown[],
  impl: (async () => true) as (arg: unknown) => Promise<unknown>,
  apiCalls: [] as string[],
}));

// Writes must be allowed for the handler to reach the API; the real config is pinned read-only by tests/setup.ts.
vi.mock("../../src/config.js", () => ({
  config: { apiKey: "test-api-key", appKey: "test-app-key", site: "datadoghq.com", allowWrite: true, enabledCategories: null, disabledCategories: null },
  validateConfig: () => {},
}));
vi.mock("../../src/client.js", () => ({
  syntheticsApi: {
    updateTestPauseStatus: (arg: unknown) => {
      fake.calls.push(arg);
      return fake.impl(arg);
    },
    getAPITest: async () => {
      fake.apiCalls.push("get");
      return { name: "api test", config: { request: { url: "https://x.test" } }, locations: ["aws:us-east-2"], message: "", options: {}, tags: [], status: "paused" };
    },
    updateAPITest: async (arg: { publicId: string; body: { status: string } }) => {
      fake.apiCalls.push(`put ${arg.body.status}`);
      return { publicId: arg.publicId, name: "api test", status: arg.body.status };
    },
  },
}));

import { setSyntheticsTestStatus, testLockKey, withLock } from "../../src/tools/synthetics-browser.js";
import { updateSyntheticsTest } from "../../src/tools/synthetics.js";
import { redactText } from "../../src/tools/utils.js";

beforeEach(() => {
  fake.calls.length = 0;
  fake.apiCalls.length = 0;
  fake.impl = async () => true;
});

describe("setSyntheticsTestStatus", () => {
  it("applies the status to each test and reports per-test results", async () => {
    const result = await setSyntheticsTestStatus({ publicIds: ["a-b-c", "d-e-f"], status: "live" });
    expect(fake.calls).toEqual([
      { publicId: "a-b-c", body: { newStatus: "live" } },
      { publicId: "d-e-f", body: { newStatus: "live" } },
    ]);
    expect(result).toMatchObject({ requestedStatus: "live", succeeded: 2, failed: 0 });
  });

  it("waits for an in-flight edit of the same test so the edit cannot undo the status", async () => {
    const events: string[] = [];
    let finishEdit!: () => void;
    const edit = withLock(testLockKey("abc-def-ghi"), () => new Promise<void>((resolve) => {
      finishEdit = () => { events.push("edit saved"); resolve(); };
    }));
    fake.impl = async () => { events.push("status applied"); return true; };

    const status = setSyntheticsTestStatus({ publicIds: ["abc-def-ghi"], status: "paused" });
    await new Promise((r) => setTimeout(r, 25));
    expect(events).toEqual([]); // still queued behind the edit

    finishEdit();
    await Promise.all([edit, status]);
    expect(events).toEqual(["edit saved", "status applied"]);
  });

  it("does not make tests with different ids wait for each other", async () => {
    let finishEdit!: () => void;
    const edit = withLock(testLockKey("slow-one"), () => new Promise<void>((r) => { finishEdit = r; }));
    const result = await setSyntheticsTestStatus({ publicIds: ["other-test"], status: "paused" });
    expect(result.succeeded).toBe(1);
    finishEdit();
    await edit;
  });

  it("redacts keys echoed in a per-test error, because those errors are returned as data", async () => {
    fake.impl = async () => { throw new Error("HTTP 403: invalid keys test-api-key / test-app-key"); };
    const result = await setSyntheticsTestStatus({ publicIds: ["abc-def-ghi"], status: "paused" });
    expect(result.failed).toBe(1);
    const message = result.results[0].error ?? "";
    expect(message).not.toContain("test-api-key");
    expect(message).not.toContain("test-app-key");
    expect(message).toContain("[REDACTED]");
  });

  it("keeps going after one test fails and reports each result", async () => {
    fake.impl = async (arg) => {
      if ((arg as { publicId: string }).publicId === "bad-one") throw new Error("not found");
      return true;
    };
    const result = await setSyntheticsTestStatus({ publicIds: ["bad-one", "good-one"], status: "live" });
    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    expect(result.results.map((r) => r.ok)).toEqual([false, true]);
  });
});

describe("updateSyntheticsTest (API tests) and the status lock", () => {
  it("waits for an in-flight status change on the same test, so it cannot restart a paused test", async () => {
    const events: string[] = [];
    let finishPause!: () => void;
    const pause = withLock(testLockKey("api-test-1"), () => new Promise<void>((resolve) => {
      finishPause = () => { events.push("paused"); resolve(); };
    }));

    const edit = updateSyntheticsTest({ publicId: "api-test-1", name: "renamed" });
    await new Promise((r) => setTimeout(r, 25));
    expect(fake.apiCalls).toEqual([]); // has not even read the test yet

    finishPause();
    await Promise.all([pause, edit]);
    expect(events).toEqual(["paused"]);
    expect(fake.apiCalls).toEqual(["get", "put paused"]);
  });
});

describe("redactText", () => {
  it("removes configured key values from any text", () => {
    expect(redactText("get-monitor 1 failed: key test-api-key rejected")).not.toContain("test-api-key");
  });
});
