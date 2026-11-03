import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";

describe(".env.example", () => {
  it("parses cleanly when every commented setting is enabled (no note ends up inside a value)", () => {
    const text = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
    // Uncomment the lines that look like settings (# NAME=value), leave prose comments alone.
    const enabled = text
      .split(/\r?\n/)
      .map((line) => line.replace(/^#\s*(?=[A-Z][A-Z0-9_]*=)/, ""))
      .join("\n");
    const values = parse(enabled);
    expect(Object.keys(values)).toEqual(expect.arrayContaining(["DD_BROWSER_STEP_TYPES", "DD_BROWSER_URL_HOSTS", "DD_ALLOW_PRIVATE_LOCATIONS"]));
    for (const [name, value] of Object.entries(values)) {
      expect(value, name).not.toMatch(/\s/);
      expect(value, name).not.toMatch(/[()]/);
    }
  });
});
