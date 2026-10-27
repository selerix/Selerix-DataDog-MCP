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

  it("serves many requests, one after another (a stateless transport cannot be reused)", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    server.tool("ping", "ping", {}, async () => ({ content: [{ type: "text" as const, text: "pong" }] }));
    const handle = (await startMcpServer(server, { transport: "http", port: 0, host: "127.0.0.1", token: "tok" })) as HttpHandle;
    try {
      const url = `http://127.0.0.1:${handle.port}/mcp`;
      const rpc = (id: number, method: string, params?: unknown) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer tok" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        });
      const first = await rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } });
      expect(first.status).toBe(200);
      await first.text();
      const second = await rpc(2, "tools/list");
      expect(second.status).toBe(200);
      expect(await second.text()).toContain("ping");
      const third = await rpc(3, "tools/call", { name: "ping", arguments: {} });
      expect(third.status).toBe(200);
      expect(await third.text()).toContain("pong");
    } finally {
      await handle.close();
    }
  });

  it("handles concurrent requests without mixing up the responses", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    server.tool("ping", "ping", {}, async () => ({ content: [{ type: "text" as const, text: "pong" }] }));
    const handle = (await startMcpServer(server, { transport: "http", port: 0, host: "127.0.0.1", token: "tok" })) as HttpHandle;
    try {
      const url = `http://127.0.0.1:${handle.port}/mcp`;
      const bodies = await Promise.all(
        [11, 12, 13, 14, 15].map(async (id) => {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer tok" },
            body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "ping", arguments: {} } }),
          });
          return { id, status: res.status, text: await res.text() };
        }),
      );
      for (const b of bodies) {
        expect(b.status).toBe(200);
        expect(b.text).toContain(`"id":${b.id}`);
        expect(b.text).toContain("pong");
      }
    } finally {
      await handle.close();
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
