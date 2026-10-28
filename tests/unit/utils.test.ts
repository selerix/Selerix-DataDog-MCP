import { describe, it, expect, vi } from "vitest";
import { wrapToolHandler, WriteBlockedError, assertWriteAllowed, secretValuePatterns } from "../../src/tools/utils.js";

describe("wrapToolHandler", () => {
  it("wraps successful result into MCP content format", async () => {
    const handler = wrapToolHandler(async () => ({ count: 1, items: ["a"] }));
    const result = await handler({} as any);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
  });

  it("catches WriteBlockedError and returns isError", async () => {
    const handler = wrapToolHandler(async () => {
      throw new WriteBlockedError();
    });
    const result = await handler({} as any);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Write operations are disabled");
  });

  it("redacts every occurrence of a secret word or bearer value, not just the first", async () => {
    const handler = wrapToolHandler(async () => {
      throw new Error("Bearer abcdef123 retried with Bearer ghijkl456; token and token again");
    });
    const result = await handler({} as any);
    const text = result.content[0].text;
    expect(text).not.toMatch(/abcdef123|ghijkl456|token/);
  });

  it("removes the secret value that follows a secret word, in several shapes", async () => {
    const cases = [
      "password=Hunter2!x token=abc123 token=def456",
      'body {"password":"Hunter2!x","token": "abc123"} failed',
      "Authorization: Bearer abc123def456 rejected",
      'body {"password":"Hunter2\\"tail-part","x":1}',
      "password='Hunter2\\'tail-part' next",
      "client_secret=abc123 and access_token: def456",
      "jwt eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4fw here",
      "key AKIAABCDEFGHIJKLMNOP leaked",
    ];
    for (const message of cases) {
      const handler = wrapToolHandler(async () => { throw new Error(message); });
      const text = (await handler({} as any)).content[0].text;
      expect(text, message).not.toMatch(/Hunter2|tail-part|abc123|def456|eyJ|AKIA/);
    }
  });

  it("redacts values held under secret-looking keys in a structured Datadog error", async () => {
    const handler = wrapToolHandler(async () => {
      const err = new Error("Bad Request") as Error & { code: number; body: unknown };
      err.code = 400;
      err.body = { errors: [{ detail: "rejected", password: "Hunter2!x", nested: { access_token: "abc123", note: "keep me" } }, "plain"] };
      throw err;
    });
    const result = await handler({} as any);
    const text = result.content[0].text;
    expect(text).not.toMatch(/Hunter2|abc123/);
    expect(text).toContain("keep me");
    expect(text).toContain("rejected");
    expect(JSON.parse(text).status).toBe(400);
  });

  it("keeps ordinary error text readable", async () => {
    const handler = wrapToolHandler(async () => { throw new Error("Monitor 123 not found in us5"); });
    const parsed = JSON.parse((await handler({} as any)).content[0].text);
    expect(parsed.message).toBe("Monitor 123 not found in us5");
  });

  it("catches generic Error and returns sanitized structure", async () => {
    const handler = wrapToolHandler(async () => {
      throw new Error("something failed");
    });
    const result = await handler({} as any);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message).toBe("something failed");
  });

  it("extracts Datadog SDK ApiException fields", async () => {
    const handler = wrapToolHandler(async () => {
      const err: any = new Error("HTTP error");
      err.code = 403;
      err.body = JSON.stringify({ errors: ["Forbidden"] });
      throw err;
    });
    const result = await handler({} as any);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe(403);
    expect(parsed.datadogError).toEqual(["Forbidden"]);
  });

  it("sanitizes sensitive patterns from error messages", async () => {
    const handler = wrapToolHandler(async () => {
      throw new Error("Failed with DD_API_KEY=abc123");
    });
    const result = await handler({} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message).not.toContain("DD_API_KEY");
    expect(parsed.message).toContain("[REDACTED]");
  });

  it("removes the configured key values themselves, in messages and nested error fields", async () => {
    // tests/setup.ts configures DD_API_KEY=test-api-key and DD_APP_KEY=test-app-key
    const handler = wrapToolHandler(async () => {
      const err: any = new Error("request failed for test-api-key (retry with test-app-key too, test-api-key)");
      err.code = 403;
      err.body = JSON.stringify({ errors: ["bad key test-api-key", { detail: "app key test-app-key" }] });
      throw err;
    });
    const text = (await handler({} as any)).content[0].text;
    expect(text).not.toContain("test-api-key");
    expect(text).not.toContain("test-app-key");
    expect(text).toContain("[REDACTED]");
  });

  it("removes a key from a plain Error message as well", async () => {
    const handler = wrapToolHandler(async () => {
      throw new Error("oops test-api-key oops");
    });
    const text = (await handler({} as any)).content[0].text;
    expect(text).not.toContain("test-api-key");
  });
});

describe("secretValuePatterns", () => {
  it("escapes regex characters and skips short or empty secrets", () => {
    const [p] = secretValuePatterns(["a.b*c+d?e1234"]);
    expect("x a.b*c+d?e1234 y a.b*c+d?e1234".replace(p, "#")).toBe("x # y #");
    expect("aXbbbcde1234".replace(p, "#")).toBe("aXbbbcde1234");
    expect(secretValuePatterns(["", "x", "short"])).toEqual([]);
  });
});

describe("assertWriteAllowed", () => {
  it("throws WriteBlockedError when allowWrite is false", () => {
    expect(() => assertWriteAllowed()).toThrow(WriteBlockedError);
  });
});

describe("WriteBlockedError", () => {
  it("has correct name and message", () => {
    const err = new WriteBlockedError();
    expect(err.name).toBe("WriteBlockedError");
    expect(err.message).toContain("Write operations are disabled");
  });
});
