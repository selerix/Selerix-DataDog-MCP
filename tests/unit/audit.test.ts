import { describe, it, expect, vi, afterEach } from "vitest";
import { createAuditLogger, extractTargets, toolContext, type ToolContext } from "../../src/audit.js";
import { createWrapToolHandler } from "../../src/vendor/mcp-toolkit/index.js";

const WRITE: ToolContext = { tool: "update-synthetics-browser-test", category: "synthetics", write: true };
const READ: ToolContext = { tool: "get-monitor", category: "monitors", write: false };
const NOW = new Date("2026-10-28T12:00:00.000Z");

function logger(mode: "all" | "writes" | "off") {
  const lines: Record<string, unknown>[] = [];
  const audit = createAuditLogger({
    mode,
    redact: (t) => t.replace(/hunter2/g, "[REDACTED]"),
    write: (l) => lines.push(JSON.parse(l)),
    now: () => NOW,
  });
  return { audit, lines };
}

describe("audit logger", () => {
  it("records tool, category, kind, outcome, duration, timestamp, dryRun and target ids", () => {
    const { audit, lines } = logger("writes");
    audit.record({ ctx: WRITE, params: { publicId: "abc-def-ghi", dryRun: true }, blocked: false, durationMs: 42 });
    expect(lines).toEqual([{
      ts: "2026-10-28T12:00:00.000Z", event: "tool_call", tool: "update-synthetics-browser-test", category: "synthetics",
      kind: "write", outcome: "ok", durationMs: 42, dryRun: true, targets: { publicId: "abc-def-ghi" },
    }]);
  });

  it("never logs argument values, only identifiers", () => {
    const { audit, lines } = logger("all");
    audit.record({
      ctx: WRITE,
      params: {
        publicId: "abc-def-ghi",
        publicIds: ["a", "b"],
        monitorId: 12345,
        value: "TOP-SECRET-VALUE",
        steps: [{ type: "typeText", params: { value: "hunter2" } }],
        apiKeyId: "k-1",
        configVariables: [{ name: "PW", secure: true }],
        name: "test name",
        tagId: "x".repeat(500),
      },
      blocked: false,
      durationMs: 1,
    });
    const text = JSON.stringify(lines);
    expect(text).not.toContain("TOP-SECRET-VALUE");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("test name");
    expect(lines[0].targets).toEqual({ publicId: "abc-def-ghi", publicIds: ["a", "b"], monitorId: 12345 });
  });

  it("classifies blocked and error outcomes and redacts error text", () => {
    const { audit, lines } = logger("all");
    audit.record({ ctx: WRITE, params: {}, error: new Error("write refused"), blocked: true, durationMs: 1 });
    const failure = Object.assign(new Error("HTTP failed with hunter2"), { code: 403 });
    audit.record({ ctx: WRITE, params: {}, error: failure, blocked: false, durationMs: 2 });
    expect(lines[0]).toMatchObject({ outcome: "blocked", error: "write refused" });
    expect(lines[1]).toMatchObject({ outcome: "error", status: 403 });
    expect(lines[1].error).toBe("HTTP failed with [REDACTED]");
  });

  it("mode 'writes' skips read tools, 'all' keeps them, 'off' logs nothing", () => {
    for (const [mode, expected] of [["writes", 1], ["all", 2], ["off", 0]] as const) {
      const { audit, lines } = logger(mode);
      audit.record({ ctx: READ, params: { monitorId: 1 }, blocked: false, durationMs: 1 });
      audit.record({ ctx: WRITE, params: {}, blocked: false, durationMs: 1 });
      audit.started({ writeTools: [], skippedWriteTools: 0 });
      expect(lines.filter((l) => l.event === "tool_call"), mode).toHaveLength(expected);
      expect(lines.filter((l) => l.event === "server_start"), mode).toHaveLength(mode === "off" ? 0 : 1);
    }
  });

  it("reports which write tools a process exposes at startup", () => {
    const { audit, lines } = logger("writes");
    audit.started({ writeTools: ["set-synthetics-test-status"], skippedWriteTools: 75 });
    expect(lines[0]).toMatchObject({
      event: "server_start", audit: "writes", writeToolsEnabled: ["set-synthetics-test-status"], writeToolsHidden: 75,
    });
  });

  it("a failing sink never throws into the tool call", () => {
    const audit = createAuditLogger({ mode: "all", redact: (t) => t, write: () => { throw new Error("disk full"); } });
    expect(() => audit.record({ ctx: READ, params: {}, blocked: false, durationMs: 1 })).not.toThrow();
  });
});

describe("default stderr sink", () => {
  it("survives an asynchronous stderr error (EPIPE) instead of letting it kill the process, with one listener", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    try {
      const before = process.stderr.listenerCount("error");
      const a = createAuditLogger({ mode: "all", redact: (s) => s });
      const b = createAuditLogger({ mode: "all", redact: (s) => s });
      a.record({ ctx: WRITE, params: {}, blocked: false, durationMs: 1 });
      b.record({ ctx: WRITE, params: {}, blocked: false, durationMs: 1 });
      expect(process.stderr.listenerCount("error")).toBeLessThanOrEqual(before + 1); // not one per logger
      // With no listener, emit("error") throws, which is what becomes an uncaught exception in a real stream.
      expect(() => process.stderr.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("extractTargets", () => {
  it("returns undefined when there is nothing identifier-like", () => {
    expect(extractTargets({ query: "x" }, (s) => s)).toBeUndefined();
    expect(extractTargets(undefined, (s) => s)).toBeUndefined();
    expect(extractTargets(["a"], (s) => s)).toBeUndefined();
  });

  it("takes the test ids of trigger-synthetics from tests[].publicId and nothing else from those entries", () => {
    const out = extractTargets(
      { tests: [{ publicId: "abc-def-ghi", location: "aws:us-east-2", metadata: { ci: "SECRET-CI" } }, { publicId: "jkl-mno-pqr" }, { other: 1 }, null] },
      (s) => s,
    );
    expect(out).toEqual({ publicIds: ["abc-def-ghi", "jkl-mno-pqr"] });
    expect(JSON.stringify(out)).not.toMatch(/SECRET-CI|aws:/);
    expect(extractTargets({ tests: [{ publicId: "x".repeat(500) }, { notId: 1 }] }, (s) => s)).toBeUndefined();
    const many = Array.from({ length: 50 }, (_, i) => ({ publicId: `id-${i}` }));
    expect((extractTargets({ tests: many }, (s) => s)?.publicIds as string[]).length).toBe(20);
    expect(extractTargets({ tests: [{ publicId: "key=abc12345" }] }, () => "[R]")).toEqual({ publicIds: ["[R]"] });
  });

  it("caps long arrays", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `id-${i}`);
    expect((extractTargets({ publicIds: ids }, (s) => s)?.publicIds as string[]).length).toBe(20);
  });
});

describe("audit through the handler wrapper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("../../src/config.js");
  });

  async function load(cfg: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock("../../src/config.js", () => ({
      config: { apiKey: "test-api-key", appKey: "test-app-key", site: "datadoghq.com", allowWrite: false, writeTools: null, auditLog: "writes", ...cfg },
      validateConfig: () => {},
    }));
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { stderr.push(String(chunk)); return true; }) as never);
    const stdout = vi.spyOn(process.stdout, "write");
    const utils = await import("../../src/tools/utils.js");
    const ctxModule = await import("../../src/audit.js"); // same module instance as utils.js uses after the reset
    const lines = () => stderr.flatMap((s) => s.split("\n").filter(Boolean)).map((l) => JSON.parse(l));
    return { utils, run: ctxModule.toolContext.run.bind(ctxModule.toolContext), lines, stdout };
  }

  it("logs one stderr line per write call: ok, error and blocked, and nothing on stdout", async () => {
    const { utils, run, lines, stdout } = await load({ allowWrite: true });
    const ctx = { tool: "set-synthetics-test-status", category: "synthetics", write: true };
    const ok = utils.wrapToolHandler(async (_p: unknown) => ({ done: true }));
    const bad = utils.wrapToolHandler(async (_p: unknown) => { throw Object.assign(new Error("boom test-api-key"), { code: 500 }); });
    const blocked = utils.wrapToolHandler(async (_p: unknown) => { utils.assertWriteAllowed("create-fleet-schedule", "fleet"); });
    const params = { publicIds: ["a-b-c"], status: "live", value: "SECRET-PAYLOAD" };

    await run(ctx, () => ok(params));
    await run(ctx, () => bad(params));
    await run({ ...ctx, tool: "create-fleet-schedule", category: "fleet" }, () => blocked(params));

    const out = lines();
    expect(out.map((l) => [l.tool, l.outcome])).toEqual([
      ["set-synthetics-test-status", "ok"],
      ["set-synthetics-test-status", "error"],
      ["create-fleet-schedule", "blocked"],
    ]);
    expect(out[0].targets).toEqual({ publicIds: ["a-b-c"] });
    expect(out[1].error).not.toContain("test-api-key");
    expect(JSON.stringify(out)).not.toContain("SECRET-PAYLOAD");
    expect(typeof out[0].durationMs).toBe("number");
    expect(stdout).not.toHaveBeenCalled();
  });

  it("records 'error', not 'ok', when building the response fails after the handler succeeded", async () => {
    // Built directly (no module reset) with an injected sink, so only the wrapper's ordering is under test.
    const sink: string[] = [];
    const audit = createAuditLogger({ mode: "all", redact: (s) => s, write: (l) => sink.push(l) });
    const wrap = createWrapToolHandler({
      onCall: ({ error, durationMs }) => {
        const ctx = toolContext.getStore();
        if (ctx) audit.record({ ctx, params: {}, error, blocked: false, durationMs });
      },
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular; // JSON.stringify throws after the handler has already returned
    const result = await toolContext.run(WRITE, () => wrap(async (_p: unknown) => circular)({}));
    expect(result.isError).toBe(true);
    const lines = sink.map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1); // reported exactly once
    expect(lines[0].outcome).toBe("error");

    sink.length = 0;
    const ok = await toolContext.run(WRITE, () => wrap(async (_p: unknown) => ({ fine: true }))({}));
    expect(ok.isError).toBeUndefined();
    expect(sink.map((l) => JSON.parse(l).outcome)).toEqual(["ok"]);
  });

  it("does not log read tools in the default 'writes' mode, but does in 'all'", async () => {
    const readCtx = { tool: "get-monitor", category: "monitors", write: false };
    const a = await load({});
    await a.run(readCtx, () => a.utils.wrapToolHandler(async (_p: unknown) => 1)({}));
    expect(a.lines()).toEqual([]);
    vi.restoreAllMocks();
    const b = await load({ auditLog: "all" });
    await b.run(readCtx, () => b.utils.wrapToolHandler(async (_p: unknown) => 1)({}));
    expect(b.lines()).toHaveLength(1);
  });

  it("a wrapped handler called outside registration (no tool context) logs nothing and still works", async () => {
    const { utils, lines } = await load({ auditLog: "all" });
    const result = await utils.wrapToolHandler(async (_p: unknown) => ({ x: 1 }))({});
    expect(JSON.parse(result.content[0].text)).toEqual({ x: 1 });
    expect(lines()).toEqual([]);
  });
});
