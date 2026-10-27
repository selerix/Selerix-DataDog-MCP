import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatHostPort, localhostAllowedHosts, startMcpServer, type HttpHandle } from "../../src/vendor/mcp-toolkit/runtime.js";

describe("host allowlist", () => {
  it("brackets IPv6 literals the way clients send them in the Host header", () => {
    expect(formatHostPort("::1", 3000)).toBe("[::1]:3000");
    expect(formatHostPort("127.0.0.1", 3000)).toBe("127.0.0.1:3000");
    expect(formatHostPort("localhost", 3000)).toBe("localhost:3000");
  });

  it("allows every loopback spelling for an IPv4, IPv6 or named bind host", () => {
    const all = ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"];
    expect(localhostAllowedHosts("127.0.0.1", 3000).sort()).toEqual([...all].sort());
    expect(localhostAllowedHosts("localhost", 3000).sort()).toEqual([...all].sort());
    expect(localhostAllowedHosts("::1", 3000).sort()).toEqual([...all].sort());
  });
});

async function initialize(url: string, headers: Record<string, string> = {}) {
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
  });
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body,
  });
}

async function start(host: string): Promise<HttpHandle | null> {
  try {
    const handle = await startMcpServer(new McpServer({ name: "t", version: "0" }), { transport: "http", port: 0, host, token: "tok" });
    return handle as HttpHandle;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRNOTAVAIL" || (error as NodeJS.ErrnoException).code === "EAFNOSUPPORT") return null; // no IPv6 here
    throw error;
  }
}

describe("HTTP transport", () => {
  it("requires the bearer token and serves /health without it (IPv4)", async () => {
    const handle = await start("127.0.0.1");
    try {
      const base = `http://127.0.0.1:${handle!.port}`;
      expect((await fetch(`${base}/health`)).status).toBe(200);
      expect((await initialize(`${base}/mcp`)).status).toBe(401);
      expect((await initialize(`${base}/mcp`, { authorization: "Bearer tok" })).status).toBe(200);
    } finally {
      await handle?.close();
    }
  });

  it("accepts requests addressed to http://[::1]:port when bound to IPv6 loopback", async () => {
    const handle = await start("::1");
    if (!handle) return; // IPv6 loopback not available on this machine
    try {
      const res = await initialize(`http://[::1]:${handle.port}/mcp`, { authorization: "Bearer tok" });
      expect(res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });
});
