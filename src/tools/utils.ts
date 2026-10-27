import { createTextSanitizer, createWrapToolHandler } from "../vendor/mcp-toolkit/index.js";
import { config } from "../config.js";

export class WriteBlockedError extends Error {
  constructor() {
    super("Write operations are disabled. Set DD_ALLOW_WRITE=true to enable.");
    this.name = "WriteBlockedError";
  }
}

export function assertWriteAllowed(): void {
  if (!config.allowWrite) {
    throw new WriteBlockedError();
  }
}

export function extractDatadogError(body: unknown): unknown {
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      if (rec.errors != null) return rec.errors;
      if (typeof rec.message === "string") return rec.message;
    }
    return typeof body === "string" ? body : JSON.stringify(body);
  } catch {
    return String(body);
  }
}

// --- Serialization of read-merge-save sequences ---

const locks = new Map<string, Promise<void>>();

/** Lock key shared by every tool that rewrites or changes the status of one Synthetics test (any type). */
export function testLockKey(publicId: string): string {
  return `synthetics-test:${publicId}`;
}

/**
 * Runs `fn` after every earlier call with the same key has settled, so two edits of the same test (or
 * variable) in this server cannot read the same definition and overwrite each other. A failed call does
 * not block the next one. This does not protect against edits made elsewhere, such as in the Datadog UI:
 * the API has no revision check.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(() => fn());
  const tail = run.then(() => undefined, () => undefined);
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Patterns that match the actual secret values, so a key echoed in an error message is removed, not just
 * the variable name. Values shorter than 8 characters are skipped to avoid blanking ordinary text
 * (the token-stats script runs the server with placeholder keys).
 */
export function secretValuePatterns(secrets: readonly string[]): RegExp[] {
  return secrets.filter((s) => s.length >= 8).map((s) => new RegExp(escapeRegExp(s), "g"));
}

const redactionOptions = {
  redactionPatterns: [/DD_API_KEY/i, /DD_APP_KEY/i, ...secretValuePatterns([config.apiKey, config.appKey])],
};

/** Redacts secrets from text that is returned as data instead of thrown (per-item errors, caveat lists). */
export const redactText = createTextSanitizer(redactionOptions);

export const wrapToolHandler = createWrapToolHandler({
  ...redactionOptions,
  errorExtractors: [
    {
      match: (error) => error instanceof WriteBlockedError,
      extract: (error) => ({ kind: "passthrough", text: (error as Error).message }),
    },
    {
      match: (error) => {
        if (!(error instanceof Error)) return false;
        const rec = error as unknown as Record<string, unknown>;
        return (
          typeof rec.code === "number" ||
          typeof rec.body === "string" ||
          typeof rec.requestId === "string"
        );
      },
      extract: (error) => {
        const err = error as Error & Record<string, unknown>;
        const data: Record<string, unknown> & { message: string } = {
          message: err.message,
        };
        if (typeof err.code === "number") {
          data.status = err.code;
        }
        if (err.body != null) {
          data.datadogError = extractDatadogError(err.body);
        }
        if (typeof err.requestId === "string") {
          data.requestId = err.requestId;
        }
        return { kind: "structured", data };
      },
    },
  ],
});
