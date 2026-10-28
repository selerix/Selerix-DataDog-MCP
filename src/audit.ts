import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Audit log: one JSON line per tool call, on STDERR (stdout carries the MCP protocol in stdio mode).
 *
 * A line records which tool ran, when, for how long, and how it ended. It never contains argument or result
 * values: only the tool's identifiers (publicId, monitorId, ...) are copied from the arguments, and only when
 * they are short primitives. Error text is passed through the caller's redactor.
 */

export type AuditMode = "all" | "writes" | "off";
export type AuditOutcome = "ok" | "error" | "blocked";

export interface ToolContext {
  tool: string;
  category: string;
  write: boolean;
}

/** Set by the registration helper around each handler so the wrapper's hook knows which tool is running. */
export const toolContext = new AsyncLocalStorage<ToolContext>();

const MAX_TARGETS = 20;
const MAX_TARGET_LENGTH = 128;
const MAX_ERROR_LENGTH = 300;

// Keys that name a thing to act on (`publicId`, `monitorId`, `publicIds`, `id`). Anything that looks like a
// credential is excluded even if it ends in "Id".
const ID_KEY = /^(?:id|ids|.*Ids?)$/;
const SENSITIVE_KEY = /key|token|secret|passw|authorization/i;

type Target = string | number;

function isTarget(v: unknown): v is Target {
  return (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= MAX_TARGET_LENGTH);
}

/** Identifier-like arguments (id keys with short string/number values, or arrays of them); nothing else. */
export function extractTargets(params: unknown, redact: (s: string) => string): Record<string, Target | Target[]> | undefined {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return undefined;
  const out: Record<string, Target | Target[]> = {};
  const clean = (v: Target): Target => (typeof v === "string" ? redact(v) : v);
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (!ID_KEY.test(key) || SENSITIVE_KEY.test(key)) continue;
    if (isTarget(value)) out[key] = clean(value);
    else if (Array.isArray(value) && value.every(isTarget)) out[key] = value.slice(0, MAX_TARGETS).map(clean);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface AuditEvent {
  ctx: ToolContext;
  params: unknown;
  error?: unknown;
  /** True when the error is the write-permission refusal. */
  blocked: boolean;
  durationMs: number;
}

export interface AuditLoggerOptions {
  mode: AuditMode;
  redact: (text: string) => string;
  /** Receives each finished JSON line (no newline). Defaults to stderr. */
  write?: (line: string) => void;
  now?: () => Date;
}

export function createAuditLogger(opts: AuditLoggerOptions) {
  const write = opts.write ?? ((line: string) => { process.stderr.write(line + "\n"); });
  const now = opts.now ?? (() => new Date());

  function emit(record: Record<string, unknown>): void {
    try {
      write(JSON.stringify(record));
    } catch {
      // Logging must never break a tool call.
    }
  }

  return {
    /** Records one finished tool call, subject to the mode (`writes` skips read tools, `off` skips all). */
    record(e: AuditEvent): void {
      if (opts.mode === "off") return;
      if (opts.mode === "writes" && !e.ctx.write) return;
      const record: Record<string, unknown> = {
        ts: now().toISOString(),
        event: "tool_call",
        tool: e.ctx.tool,
        category: e.ctx.category,
        kind: e.ctx.write ? "write" : "read",
        outcome: (e.blocked ? "blocked" : e.error !== undefined ? "error" : "ok") satisfies AuditOutcome,
        durationMs: e.durationMs,
      };
      const dryRun = (e.params as Record<string, unknown> | null | undefined)?.dryRun;
      if (typeof dryRun === "boolean") record.dryRun = dryRun;
      const targets = extractTargets(e.params, opts.redact);
      if (targets) record.targets = targets;
      if (e.error !== undefined) {
        const status = (e.error as { code?: unknown } | null)?.code;
        if (typeof status === "number") record.status = status;
        const message = e.error instanceof Error ? e.error.message : String(e.error);
        record.error = opts.redact(message).slice(0, MAX_ERROR_LENGTH);
      }
      emit(record);
    },

    /** One line at startup saying which write tools this process exposes (nothing is logged when mode is off). */
    started(info: { writeTools: string[]; skippedWriteTools: number; previewOnlyTools?: string[] }): void {
      if (opts.mode === "off") return;
      emit({
        ts: now().toISOString(),
        event: "server_start",
        audit: opts.mode,
        writeToolsEnabled: info.writeTools,
        writeToolsHidden: info.skippedWriteTools,
        dryRunOnlyTools: info.previewOnlyTools ?? [],
      });
    },
  };
}
