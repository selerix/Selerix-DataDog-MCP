import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { isWriteTool } from "../../src/vendor/mcp-toolkit/annotations.js";

const toolCalls: { name: string; description: string; annotations?: any }[] = [];

// Mock McpServer to capture tool registrations
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    tool(name: string, description: string, ..._args: unknown[]) {
      // signature: tool(name, description, schema, annotations, handler)
      toolCalls.push({ name, description, annotations: _args[1] as any });
    }
    registerResource(..._args: unknown[]) {
      // resources are not counted as tools — no-op for this test
    }
    registerPrompt(..._args: unknown[]) {
      // prompts are not counted as tools — no-op for this test
    }
    connect() {
      return Promise.resolve();
    }
  },
  ResourceTemplate: class {
    constructor(public uriTemplate: string, public _options?: unknown) {}
  },
}));

// Mock StdioServerTransport
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));

const EXPECTED_TOOLS = [
  // Metrics (5)
  "query-metrics", "get-metrics", "get-metric-metadata", "list-active-metrics", "list-metric-tags",
  // Monitors (7)
  "get-monitors", "get-monitor", "create-monitor", "update-monitor", "delete-monitor", "mute-monitor", "validate-monitor",
  // Dashboards (5)
  "get-dashboards", "get-dashboard", "create-dashboard", "update-dashboard", "delete-dashboard",
  // Logs (3)
  "search-logs", "aggregate-logs", "send-logs",
  // Events (2)
  "get-events", "post-event",
  // Incidents (6)
  "get-incidents", "get-incident", "search-incidents", "create-incident", "update-incident", "delete-incident",
  // APM (1)
  "search-spans",
  // RUM (17)
  "search-rum-events", "aggregate-rum",
  "list-rum-applications", "get-rum-application", "create-rum-application", "update-rum-application", "delete-rum-application",
  "list-rum-metrics", "get-rum-metric", "create-rum-metric", "update-rum-metric", "delete-rum-metric",
  "list-rum-retention-filters", "get-rum-retention-filter", "create-rum-retention-filter", "update-rum-retention-filter", "delete-rum-retention-filter",
  // Hosts (2)
  "list-hosts", "get-host-totals",
  // SLOs (6)
  "list-slos", "get-slo", "get-slo-history", "create-slo", "update-slo", "delete-slo",
  // Synthetics (15)
  "list-synthetics", "get-synthetics-result", "trigger-synthetics",
  "create-synthetics-test", "update-synthetics-test", "delete-synthetics-test",
  "get-synthetics-browser-test", "get-synthetics-browser-results", "get-synthetics-browser-result",
  "update-synthetics-browser-test", "create-synthetics-browser-test", "set-synthetics-test-status",
  "list-synthetics-global-variables", "get-synthetics-global-variable", "edit-synthetics-global-variable",
  // Downtimes (3)
  "list-downtimes", "create-downtime", "cancel-downtime",
  // Security (9)
  "search-security-signals", "get-security-signal",
  "list-security-rules", "get-security-rule", "delete-security-rule",
  "list-security-suppressions", "get-security-suppression", "create-security-suppression", "delete-security-suppression",
  // Account (2)
  "get-usage-summary", "list-users",
  // Notebooks (2)
  "list-notebooks", "get-notebook",
  // OnCall (2)
  "get-team-oncall", "get-oncall-schedule",
  // Services (2)
  "list-services", "get-service-definition",
  // Containers (1)
  "list-containers",
  // Processes (1)
  "list-processes",
  // Audit (1)
  "search-audit-logs",
  // Cases (4)
  "list-cases", "get-case", "create-case", "update-case-status",
  // Error Tracking (2)
  "list-error-tracking-issues", "get-error-tracking-issue",
  // CI (4)
  "search-ci-pipelines", "aggregate-ci-pipelines", "search-ci-tests", "aggregate-ci-tests",
  // Networks (2)
  "list-network-devices", "get-network-device",
  // DORA (2)
  "send-dora-deployment", "send-dora-incident",
  // Teams (6)
  "list-teams", "get-team", "create-team", "update-team", "delete-team", "get-team-members",
  // Logs Metrics (5)
  "list-logs-metrics", "get-logs-metric", "create-logs-metric", "update-logs-metric", "delete-logs-metric",
  // Spans Metrics (5)
  "list-spans-metrics", "get-spans-metric", "create-spans-metric", "update-spans-metric", "delete-spans-metric",
  // SLO Corrections (5)
  "list-slo-corrections", "get-slo-correction", "create-slo-correction", "update-slo-correction", "delete-slo-correction",
  // APM Retention Filters (5)
  "list-apm-retention-filters", "get-apm-retention-filter", "create-apm-retention-filter", "update-apm-retention-filter", "delete-apm-retention-filter",
  // Status Pages (21)
  "list-status-pages", "get-status-page", "create-status-page", "update-status-page", "delete-status-page",
  "publish-status-page", "unpublish-status-page",
  "list-status-page-components", "get-status-page-component", "create-status-page-component", "update-status-page-component", "delete-status-page-component",
  "list-status-page-degradations", "get-status-page-degradation", "create-status-page-degradation", "update-status-page-degradation", "delete-status-page-degradation",
  "list-status-page-maintenances", "get-status-page-maintenance", "create-status-page-maintenance", "update-status-page-maintenance",
  // Fleet Automation (15)
  "list-fleet-agents", "get-fleet-agent-info", "list-fleet-agent-versions",
  "list-fleet-tracers",
  "list-fleet-deployments", "get-fleet-deployment", "create-fleet-deployment-configure", "create-fleet-deployment-upgrade", "cancel-fleet-deployment",
  "list-fleet-schedules", "get-fleet-schedule", "create-fleet-schedule", "update-fleet-schedule", "delete-fleet-schedule", "trigger-fleet-schedule",
  // Workflow Automation (3)
  "get-workflow", "list-workflow-instances", "get-workflow-instance",
  // Aggregations (2)
  "analyze-monitor-state", "slo-compliance-snapshot", "incident-triage-snapshot",
];

const ENV_KEYS = ["DD_ALLOW_WRITE", "DD_WRITE_TOOLS", "DD_TOOLS", "DD_DISABLE"] as const;
const savedEnv: Record<string, string | undefined> = {};

// config.ts reads the environment at import time, so each scenario loads a fresh copy of the server.
async function load(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  vi.resetModules();
  toolCalls.length = 0;
  for (const k of ENV_KEYS) process.env[k] = env[k] ?? "";
  await import("../../src/index.js");
  const { registry } = await import("../../src/tool-registry.js");
  return { names: toolCalls.map((t) => t.name), registry };
}

const WRITE_TOOLS = EXPECTED_TOOLS.filter(isWriteTool);
const READ_TOOLS = EXPECTED_TOOLS.filter((n) => !isWriteTool(n));
const OPT_IN_CATEGORIES = ["fleet", "security", "status-pages"];

beforeEach(() => { for (const k of ENV_KEYS) savedEnv[k] = process.env[k]; });
afterEach(() => { for (const k of ENV_KEYS) process.env[k] = savedEnv[k]; });

describe("tool registration (default: writes off)", () => {
  // The only write tools still advertised when writes are off: their dryRun previews need no permission.
  const PREVIEW_TOOLS = ["create-synthetics-browser-test", "update-synthetics-browser-test"];

  it("registers the read tools, search-tools and the dry-run preview tools, and no other write tool", async () => {
    const { names } = await load({});
    expect(WRITE_TOOLS).toHaveLength(76);
    expect(names.filter(isWriteTool).sort()).toEqual(PREVIEW_TOOLS);
    expect(names).toHaveLength(READ_TOOLS.length + 1 + PREVIEW_TOOLS.length); // + search-tools + previews
    for (const expected of READ_TOOLS) expect(names, `missing tool: ${expected}`).toContain(expected);
  });

  it("does not list other hidden write tools through search-tools either", async () => {
    const { registry } = await load({});
    expect(registry.list().filter((t) => isWriteTool(t.name)).map((t) => t.name).sort()).toEqual(PREVIEW_TOOLS);
  });
});

describe("tool registration (writes enabled)", () => {
  it("DD_WRITE_TOOLS=all registers all 175 tools with inferred annotations", async () => {
    const { names } = await load({ DD_WRITE_TOOLS: "all" });
    expect(toolCalls).toHaveLength(175);
    for (const expected of EXPECTED_TOOLS) expect(names, `missing tool: ${expected}`).toContain(expected);
    expect(new Set(names).size).toBe(names.length); // no duplicates
    expect(toolCalls.every((t) => t.annotations?.openWorldHint === true)).toBe(true);
    expect(toolCalls.every((t) => t.description.length > 0)).toBe(true);
    const byName = new Map(toolCalls.map((t) => [t.name, t.annotations]));
    expect(byName.get("get-monitors")?.readOnlyHint).toBe(true);
    expect(byName.get("create-monitor")?.readOnlyHint).toBe(false);
    expect(byName.get("create-monitor")?.destructiveHint).toBeUndefined();
    expect(byName.get("delete-monitor")?.readOnlyHint).toBe(false);
    expect(byName.get("delete-monitor")?.destructiveHint).toBe(true);
  });

  it("DD_ALLOW_WRITE=true keeps working but leaves fleet, security and status-page writes off", async () => {
    const { names, registry } = await load({ DD_ALLOW_WRITE: "true" });
    const categoryOf = new Map(registry.list().map((t) => [t.name, t.category]));
    const writes = names.filter(isWriteTool);
    expect(writes).toContain("create-monitor");
    expect(writes).toContain("set-synthetics-test-status");
    expect(writes.filter((n) => OPT_IN_CATEGORIES.includes(categoryOf.get(n) as string))).toEqual([]);
    const hidden = WRITE_TOOLS.filter((n) => !names.includes(n));
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden).toContain("create-fleet-schedule");
    expect(hidden).toContain("delete-security-rule");
    expect(hidden).toContain("publish-status-page");
  });

  it("DD_WRITE_TOOLS=synthetics enables only the synthetics writes, even with DD_ALLOW_WRITE=true", async () => {
    const { names, registry } = await load({ DD_WRITE_TOOLS: "synthetics", DD_ALLOW_WRITE: "true" });
    const categoryOf = new Map(registry.list().map((t) => [t.name, t.category]));
    const writes = names.filter(isWriteTool);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((n) => categoryOf.get(n) === "synthetics")).toBe(true);
    expect(writes).not.toContain("create-monitor");
  });

  it("DD_WRITE_TOOLS accepts single tool names and opt-in categories", async () => {
    const { names } = await load({ DD_WRITE_TOOLS: "set-synthetics-test-status, fleet" });
    const writes = names.filter(isWriteTool);
    expect(writes).toContain("set-synthetics-test-status");
    expect(writes).toContain("create-fleet-schedule");
    expect(writes).toContain("update-synthetics-browser-test"); // advertised for dryRun previews only; its saves stay blocked
    expect(writes).not.toContain("edit-synthetics-global-variable");
    expect(writes).not.toContain("create-monitor");
  });

  it("a write tool in a category disabled by DD_DISABLE is not registered even when allowed", async () => {
    const { names } = await load({ DD_WRITE_TOOLS: "all", DD_DISABLE: "synthetics" });
    expect(names).not.toContain("set-synthetics-test-status");
    expect(names).toContain("create-monitor");
  });
});

describe("write call sites match registration", () => {
  // Every write tool's handler names itself and its category in assertWriteAllowed("tool", "category"); a wrong
  // pair would let a directly-called handler escape (or wrongly hit) the policy, so compare with the registry.
  it("each write tool has exactly one matching assertWriteAllowed(tool, category) call, and no stray ones", async () => {
    const { registry } = await load({ DD_WRITE_TOOLS: "all" });
    const sites = new Map<string, string>();
    for (const f of readdirSync("src/tools").filter((n) => n.endsWith(".ts") && n !== "utils.ts")) {
      const text = readFileSync(`src/tools/${f}`, "utf8");
      for (const m of text.matchAll(/assertWriteAllowed\("([^"]+)", "([^"]+)"\)/g)) {
        expect(sites.has(m[1]), `duplicate call site for ${m[1]}`).toBe(false);
        sites.set(m[1], m[2]);
      }
      expect(text, `${f} calls assertWriteAllowed without a tool name`).not.toMatch(/assertWriteAllowed\(\)/);
    }
    const registeredWrites = new Map(registry.list().filter((t) => isWriteTool(t.name)).map((t) => [t.name, t.category]));
    expect(Object.fromEntries(sites)).toEqual(Object.fromEntries(registeredWrites));
  });
});
