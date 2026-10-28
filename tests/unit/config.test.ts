import { describe, it, expect, vi, beforeEach } from "vitest";

// Keep a developer's local .env from leaking into these tests.
vi.mock("dotenv", () => ({ default: { config: () => ({}) } }));

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("validateConfig throws when DD_API_KEY is missing", async () => {
    process.env.DD_API_KEY = "";
    process.env.DD_APP_KEY = "test";
    const { validateConfig } = await import("../../src/config.js");
    expect(() => validateConfig()).toThrow("DD_API_KEY");
    process.env.DD_API_KEY = "test-api-key";
  });

  it("validateConfig throws when DD_APP_KEY is missing", async () => {
    process.env.DD_API_KEY = "test";
    process.env.DD_APP_KEY = "";
    const { validateConfig } = await import("../../src/config.js");
    expect(() => validateConfig()).toThrow("DD_APP_KEY");
    process.env.DD_APP_KEY = "test-app-key";
  });

  it("validateConfig rejects a DD_SITE that is not an official Datadog site", async () => {
    for (const site of ["evil.example.com", "api.datadoghq.com.evil.test", "datadoghq.com/x", ""]) {
      vi.resetModules();
      process.env.DD_SITE = site;
      const { validateConfig } = await import("../../src/config.js");
      if (site === "") continue; // empty falls back to nothing: covered below
      expect(() => validateConfig(), site).toThrow(/not an official Datadog site/);
    }
    process.env.DD_SITE = "us5.datadoghq.com";
  });

  it("validateConfig accepts every official site, ignoring case and spaces", async () => {
    for (const site of ["datadoghq.com", "us3.datadoghq.com", "us5.datadoghq.com", "ap1.datadoghq.com", "ap2.datadoghq.com", "datadoghq.eu", "ddog-gov.com", " DatadogHQ.com "]) {
      vi.resetModules();
      process.env.DD_SITE = site;
      const { validateConfig, config } = await import("../../src/config.js");
      expect(() => validateConfig(), site).not.toThrow();
      expect(config.site).toBe(site.trim().toLowerCase());
    }
    process.env.DD_SITE = "us5.datadoghq.com";
  });

  it("an empty or blank DD_AUDIT_LOG means the default, but a typo is still refused", async () => {
    for (const blank of ["", "   "]) {
      vi.resetModules();
      process.env.DD_AUDIT_LOG = blank;
      const { config, validateConfig } = await import("../../src/config.js");
      expect(config.auditLog, JSON.stringify(blank)).toBe("writes");
      expect(() => validateConfig()).not.toThrow();
    }
    vi.resetModules();
    process.env.DD_AUDIT_LOG = "of";
    const { validateConfig } = await import("../../src/config.js");
    expect(() => validateConfig()).toThrow(/DD_AUDIT_LOG/);
    process.env.DD_AUDIT_LOG = "off";
  });

  it("config.site defaults to us5.datadoghq.com", async () => {
    delete process.env.DD_SITE;
    const { config } = await import("../../src/config.js");
    expect(config.site).toBe("us5.datadoghq.com");
    process.env.DD_SITE = "us5.datadoghq.com";
  });

  it("config.allowWrite is true only when DD_ALLOW_WRITE=true", async () => {
    process.env.DD_ALLOW_WRITE = "false";
    const mod1 = await import("../../src/config.js");
    expect(mod1.config.allowWrite).toBe(false);

    vi.resetModules();
    process.env.DD_ALLOW_WRITE = "true";
    const mod2 = await import("../../src/config.js");
    expect(mod2.config.allowWrite).toBe(true);
    delete process.env.DD_ALLOW_WRITE;
  });

  it("parses DD_WRITE_TOOLS as a lowercase list and leaves it null when unset", async () => {
    process.env.DD_WRITE_TOOLS = " Synthetics, set-Synthetics-test-status ,";
    vi.resetModules();
    expect((await import("../../src/config.js")).config.writeTools).toEqual(["synthetics", "set-synthetics-test-status"]);
    process.env.DD_WRITE_TOOLS = "";
    vi.resetModules();
    expect((await import("../../src/config.js")).config.writeTools).toBeNull();
  });

  it("DD_AUDIT_LOG defaults to writes, accepts all|writes|off and rejects anything else at startup", async () => {
    const saved = process.env.DD_AUDIT_LOG;
    try {
      delete process.env.DD_AUDIT_LOG;
      vi.resetModules();
      expect((await import("../../src/config.js")).config.auditLog).toBe("writes");
      for (const mode of ["all", "writes", "off", " OFF "]) {
        process.env.DD_AUDIT_LOG = mode;
        vi.resetModules();
        const { validateConfig } = await import("../../src/config.js");
        expect(() => validateConfig(), mode).not.toThrow();
      }
      process.env.DD_AUDIT_LOG = "of";
      vi.resetModules();
      const { validateConfig } = await import("../../src/config.js");
      expect(() => validateConfig()).toThrow(/DD_AUDIT_LOG "of"/);
    } finally {
      process.env.DD_AUDIT_LOG = saved;
    }
  });
});
