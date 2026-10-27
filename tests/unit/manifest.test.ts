import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (file: string) => JSON.parse(readFileSync(resolve(__dirname, "..", "..", file), "utf8"));

// The workflow that used to sync server.json with package.json is disabled, so guard against drift here.
describe("server.json", () => {
  const pkg = read("package.json");
  const server = read("server.json");

  it("has the same version as package.json at the top level and on the npm package", () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].version).toBe(pkg.version);
  });

  it("points at this package and the Selerix registry it is published to", () => {
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.packages[0].registryBaseUrl).toBe(pkg.publishConfig.registry);
  });
});
