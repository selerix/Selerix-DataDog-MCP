/**
 * Server runtime — single entry point for stdio and Streamable HTTP transports.
 *
 * Transport is selected by `MCP_TRANSPORT` env (`stdio` | `http`), defaulting to `stdio`.
 * In `http` mode, requires `MCP_HTTP_TOKEN` for Bearer auth (or `MCP_HTTP_SKIP_AUTH=true`).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export type TransportKind = "stdio" | "http";

export interface StartMcpServerOptions {
  /** Force a transport instead of reading MCP_TRANSPORT. */
  transport?: TransportKind;
  /** HTTP port (default MCP_HTTP_PORT or 3000). Use 0 for an ephemeral port. */
  port?: number;
  /** HTTP bind host (default MCP_HTTP_HOST or 127.0.0.1). */
  host?: string;
  /** Bearer token for HTTP mode (default MCP_HTTP_TOKEN). */
  token?: string;
  /** Disable HTTP auth (default MCP_HTTP_SKIP_AUTH). */
  skipAuth?: boolean;
  /** Host header allowlist for DNS-rebinding protection. */
  allowedHosts?: string[];
}

export interface HttpHandle {
  port: number;
  close: () => Promise<void>;
}

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** Host:port as it appears in a URL or Host header; IPv6 literals are wrapped in brackets. */
export function formatHostPort(host: string, port: number): string {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

// Selerix change: upstream built this list as `${host}:${port}`, which for an IPv6 bind host such as ::1
// gives "::1:3000" while clients send "[::1]:3000", so every request was rejected as an invalid Host.
export function localhostAllowedHosts(host: string, port: number): string[] {
  return [...new Set([host, "localhost", "127.0.0.1", "::1"])].map((h) => formatHostPort(h, port));
}

function resolveTransport(opt: TransportKind | undefined): TransportKind {
  if (opt) return opt;
  const env = process.env.MCP_TRANSPORT?.toLowerCase();
  return env === "http" ? "http" : "stdio";
}

function resolveBoolEnv(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const lower = v.toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  return undefined;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Connect the MCP server to the configured transport.
 *
 * - `stdio` (default): starts a `StdioServerTransport` and returns once connected.
 * - `http`: starts a Node http server hosting `/mcp` (POST/GET/DELETE) for Streamable
 *   HTTP transport plus a public `/health` endpoint, and returns a handle for inspecting
 *   the bound port and shutting down. Bearer auth via `MCP_HTTP_TOKEN`.
 *
 * Concurrent requests share a single stateless `StreamableHTTPServerTransport` instance.
 */
export async function startMcpServer(
  server: McpServer,
  opts: StartMcpServerOptions = {},
): Promise<HttpHandle | void> {
  const kind = resolveTransport(opts.transport);

  if (kind === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP server running on stdio");
    return;
  }

  const port = opts.port ?? Number(process.env.MCP_HTTP_PORT ?? 3000);
  const host = opts.host ?? process.env.MCP_HTTP_HOST ?? "127.0.0.1";
  const token = opts.token ?? process.env.MCP_HTTP_TOKEN;
  const skipAuth = opts.skipAuth ?? resolveBoolEnv("MCP_HTTP_SKIP_AUTH") ?? false;

  if (!skipAuth && !token) {
    throw new Error(
      "HTTP transport requires MCP_HTTP_TOKEN (or set MCP_HTTP_SKIP_AUTH=true / opts.skipAuth=true).",
    );
  }

  const isLocalhost = LOCALHOST_HOSTS.has(host);
  let transport: StreamableHTTPServerTransport | undefined;

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = (req.url ?? "/").split("?")[0];
      if (path === "/health") {
        writeJson(res, 200, { status: "ok", transport: "http" });
        return;
      }
      if (path !== "/mcp") {
        writeJson(res, 404, { error: "not found" });
        return;
      }
      if (!skipAuth) {
        const header = req.headers.authorization;
        if (header !== `Bearer ${token}`) {
          writeJson(res, 401, { error: "unauthorized" });
          return;
        }
      }
      if (!transport) {
        writeJson(res, 503, { error: "transport not ready" });
        return;
      }
      await transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) {
        writeJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      } else {
        res.end();
      }
    }
  });

  return new Promise<HttpHandle>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, async () => {
      try {
        const address = httpServer.address();
        const boundPort = typeof address === "object" && address ? address.port : port;
        const allowedHosts =
          opts.allowedHosts ??
          (isLocalhost ? localhostAllowedHosts(host, boundPort) : undefined);

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableDnsRebindingProtection: allowedHosts !== undefined,
          allowedHosts,
        });
        await server.connect(transport);

        const authState = skipAuth ? " (auth disabled)" : "";
        console.error(`MCP server running on http://${formatHostPort(host, boundPort)}/mcp${authState}`);

        resolve({
          port: boundPort,
          close: () =>
            new Promise<void>((res, rej) => {
              transport?.close().catch(() => {});
              httpServer.close((err) => (err ? rej(err) : res()));
            }),
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}
