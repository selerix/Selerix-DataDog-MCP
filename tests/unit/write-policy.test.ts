import { describe, it, expect, vi } from "vitest";
import { isWriteToolAllowed, writesConfigured } from "../../src/write-policy.js";

describe("isWriteToolAllowed", () => {
  it("allows nothing when writes are off", () => {
    expect(isWriteToolAllowed({ allowWrite: false, writeTools: null }, "create-monitor", "monitors")).toBe(false);
    expect(isWriteToolAllowed({ allowWrite: false }, "set-synthetics-test-status", "synthetics")).toBe(false);
  });

  it("DD_ALLOW_WRITE=true allows ordinary categories", () => {
    expect(isWriteToolAllowed({ allowWrite: true, writeTools: null }, "create-monitor", "monitors")).toBe(true);
    expect(isWriteToolAllowed({ allowWrite: true }, "set-synthetics-test-status", "synthetics")).toBe(true);
  });

  it("DD_ALLOW_WRITE=true still blocks fleet, security and status-pages writes", () => {
    for (const [tool, category] of [
      ["create-fleet-schedule", "fleet"],
      ["delete-security-rule", "security"],
      ["publish-status-page", "status-pages"],
    ]) {
      expect(isWriteToolAllowed({ allowWrite: true, writeTools: null }, tool, category), tool).toBe(false);
    }
  });

  it("DD_WRITE_TOOLS replaces DD_ALLOW_WRITE: only listed categories and tools are allowed", () => {
    const cfg = { allowWrite: true, writeTools: ["synthetics", "create-monitor"] };
    expect(isWriteToolAllowed(cfg, "update-synthetics-browser-test", "synthetics")).toBe(true);
    expect(isWriteToolAllowed(cfg, "create-monitor", "monitors")).toBe(true);
    expect(isWriteToolAllowed(cfg, "delete-monitor", "monitors")).toBe(false);
    expect(isWriteToolAllowed(cfg, "create-fleet-schedule", "fleet")).toBe(false);
  });

  it("DD_WRITE_TOOLS can opt in a sensitive category or a single tool, with writes otherwise off", () => {
    const cfg = { allowWrite: false, writeTools: ["fleet", "delete-security-rule"] };
    expect(isWriteToolAllowed(cfg, "cancel-fleet-deployment", "fleet")).toBe(true);
    expect(isWriteToolAllowed(cfg, "delete-security-rule", "security")).toBe(true);
    expect(isWriteToolAllowed(cfg, "create-security-suppression", "security")).toBe(false);
    expect(isWriteToolAllowed(cfg, "create-monitor", "monitors")).toBe(false);
  });

  it("'all' allows every write tool, opt-in categories included", () => {
    const cfg = { allowWrite: false, writeTools: ["all"] };
    expect(isWriteToolAllowed(cfg, "create-fleet-schedule", "fleet")).toBe(true);
    expect(isWriteToolAllowed(cfg, "create-monitor", "monitors")).toBe(true);
  });

  it("an empty DD_WRITE_TOOLS list falls back to DD_ALLOW_WRITE", () => {
    expect(isWriteToolAllowed({ allowWrite: true, writeTools: [] }, "create-monitor", "monitors")).toBe(true);
    expect(isWriteToolAllowed({ allowWrite: false, writeTools: [] }, "create-monitor", "monitors")).toBe(false);
  });

  it("writesConfigured reflects either switch", () => {
    expect(writesConfigured({ allowWrite: false, writeTools: null })).toBe(false);
    expect(writesConfigured({ allowWrite: true })).toBe(true);
    expect(writesConfigured({ allowWrite: false, writeTools: ["synthetics"] })).toBe(true);
  });
});

describe("assertWriteAllowed (defence in depth for directly called handlers)", () => {
  async function withConfig(cfg: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock("../../src/config.js", () => ({
      config: { apiKey: "test-api-key", appKey: "test-app-key", site: "datadoghq.com", auditLog: "off", ...cfg },
      validateConfig: () => {},
    }));
    return import("../../src/tools/utils.js");
  }

  it("blocks everything when writes are off, with the generic message", async () => {
    const { assertWriteAllowed, WriteBlockedError } = await withConfig({ allowWrite: false, writeTools: null });
    expect(() => assertWriteAllowed("create-monitor", "monitors")).toThrow(WriteBlockedError);
    expect(() => assertWriteAllowed("create-monitor", "monitors")).toThrow(/Write operations are disabled/);
  });

  it("blocks a sensitive category under DD_ALLOW_WRITE=true and names the way to enable it", async () => {
    const { assertWriteAllowed } = await withConfig({ allowWrite: true, writeTools: null });
    expect(() => assertWriteAllowed("create-monitor", "monitors")).not.toThrow();
    expect(() => assertWriteAllowed("create-fleet-schedule", "fleet")).toThrow(/DD_WRITE_TOOLS/);
  });

  it("blocks a tool outside the allowlist", async () => {
    const { assertWriteAllowed } = await withConfig({ allowWrite: false, writeTools: ["synthetics"] });
    expect(() => assertWriteAllowed("set-synthetics-test-status", "synthetics")).not.toThrow();
    expect(() => assertWriteAllowed("create-monitor", "monitors")).toThrow(/not enabled for "create-monitor"/);
  });
});
