/**
 * Server runtime — single entry point for stdio and Streamable HTTP transports.
 *
 * Transport is selected by `MCP_TRANSPORT` env (`stdio` | `http`), defaulting to `stdio`.
 * In `http` mode, requires `MCP_HTTP_TOKEN` for Bearer auth (or `MCP_HTTP_SKIP_AUTH=true`).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer,type IncomingMessage, type ServerResponse } from "node:http";
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
  /** Selerix addition: allow binding to a non-loopback host (default MCP_HTTP_ALLOW_REMOTE, off). */
  allowRemote?: boolean;
  /** Selerix addition: longest a single HTTP request may take before it is cut off (default 10 minutes). */
  requestTimeoutMs?: number;
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

// Selerix change: constant-time bearer check (hashing first gives equal-length buffers).
export function tokenMatches(header: string | undefined, token: string): boolean {
  const sha = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(sha(header ?? ""), sha(`Bearer ${token}`));
}

// Selerix change: MCP_HTTP_ALLOWED_HOSTS="host:port,..." supplies the Host allowlist for non-loopback binds.
function envList(raw: string | undefined): string[] | undefined {
  const list = raw?.split(",").map((s) => s.trim()).filter(Boolean);
  return list && list.length > 0 ? list : undefined;
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
  // Selerix change: auth can only be turned off for a loopback bind. Anything reachable from the network
  // must present the token.
  if (skipAuth && !isLocalhost) {
    throw new Error(`MCP_HTTP_SKIP_AUTH is only allowed when bound to localhost, not ${host}.`);
  }
  // Selerix change: every caller of the HTTP mode shares one Datadog identity and one static token, so it is a
  // single-user, same-machine convenience. Listening beyond loopback must be asked for explicitly.
  const allowRemote = opts.allowRemote ?? resolveBoolEnv("MCP_HTTP_ALLOW_REMOTE") ?? false;
  if (!isLocalhost && !allowRemote) {
    throw new Error(
      `HTTP transport refuses to listen on ${host}: it has no per-user identity, so it is limited to localhost. ` +
        "Set MCP_HTTP_ALLOW_REMOTE=true only behind a gateway that authenticates each user.",
    );
  }
  let allowedHosts: string[] | undefined;

  // Selerix change: upstream connected one stateless transport at startup and reused it for every request.
  // The SDK rejects that (HTTP 500 from the second request on). A server can only be connected to one
  // transport at a time and a stateless transport serves one request, so each request gets a fresh
  // transport, connected for the length of that request, and requests are handled one at a time.
  let queue: Promise<void> = Promise.resolve();
  const requestTimeoutMs = opts.requestTimeoutMs ?? 10 * 60 * 1000;
  const handleMcpRequest = (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Watch for the client going away from the moment the request arrives, not from its turn. A request
    // that waits behind a slow one can be abandoned before it is served, and 'close' fires only once, so a
    // listener added later would wait forever and block every request behind it.
    let clientGone = res.destroyed;
    const gone = new Promise<void>((resolve) => {
      if (clientGone) resolve();
      else res.once("close", () => { clientGone = true; resolve(); });
    });

    const run = queue.then(async () => {
      if (clientGone) return; // nobody is left to answer
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableDnsRebindingProtection: allowedHosts !== undefined,
        allowedHosts,
      });
      await server.connect(transport);
      // Safety net: a request that never finishes must not hold up every request behind it.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<void>((resolve) => {
        timer = setTimeout(() => { res.destroy(); resolve(); }, requestTimeoutMs);
      });
      try {
        await Promise.race([
          (async () => { await transport.handleRequest(req, res); await gone; })(),
          timedOut,
        ]);
      } finally {
        clearTimeout(timer);
        await transport.close().catch(() => {});
      }
    });
    queue = run.catch(() => {});
    return run;
  };

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
        if (!tokenMatches(header, token!)) {
          writeJson(res, 401, { error: "unauthorized" });
          return;
        }
      }
      // Selerix change: a stateless transport has no session to stream notifications on, but it accepts
      // the optional GET /mcp stream and keeps it open, which would hold the one-at-a-time queue until the
      // client leaves or the request timeout fires. Only POST is served.
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        writeJson(res, 405, { error: "method not allowed" });
        return;
      }
      await handleMcpRequest(req, res);
    } catch (err) {
      // Selerix change: the raw message is not sent to the client (it could carry secrets); it goes to stderr.
      console.error("MCP HTTP request failed:", err instanceof Error ? err.message : String(err));
      if (!res.headersSent) {
        writeJson(res, 500, { error: "internal server error" });
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
        allowedHosts =
          opts.allowedHosts ??
          envList(process.env.MCP_HTTP_ALLOWED_HOSTS) ??
          (isLocalhost ? localhostAllowedHosts(host, boundPort) : undefined);

        const authState = skipAuth ? " (auth disabled)" : "";
        console.error(`MCP server running on http://${formatHostPort(host, boundPort)}/mcp${authState}`);

        resolve({
          port: boundPort,
          close: () =>
            new Promise<void>((res, rej) => {
              httpServer.close((err) => (err ? rej(err) : res()));
            }),
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}
