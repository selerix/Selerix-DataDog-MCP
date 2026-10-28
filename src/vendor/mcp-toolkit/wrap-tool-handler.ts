/**
 * Tool handler wrapper factory — error sanitization, structured error responses,
 * and automatic `extractFields` projection on success.
 *
 * Each consumer MCP server has its own auth/error class shapes; pass them via
 * `errorExtractors`. The shared core handles MCP response shaping + redaction.
 */
import { applyExtractFields } from "./extract-fields.js";

export type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type StructuredError = Record<string, unknown> & { message: string };

export type ErrorHandling =
  | { kind: "structured"; data: StructuredError; sanitize?: boolean }
  | { kind: "passthrough"; text: string };

export interface ErrorExtractor {
  match: (error: unknown) => boolean;
  extract: (error: unknown) => ErrorHandling;
}

export interface CreateWrapToolHandlerOptions {
  /** Extra patterns redacted from error text, in addition to the defaults. */
  redactionPatterns?: RegExp[];
  /** Custom error classifiers, tried in order before the generic fallback. */
  errorExtractors?: ErrorExtractor[];
  /** Name of the tool parameter that carries the extractFields expression (default "extractFields"). */
  extractFieldsParam?: string;
}

/** Common secret patterns redacted by default. */
export const DEFAULT_REDACTION_PATTERNS: readonly RegExp[] = Object.freeze([
  /api[_-]?key/i,
  /app[_-]?key/i,
  /authorization/i,
  /bearer\s+\S+/i,
  /password/i,
  /secret/i,
  /token/i,
]);

// Selerix change: patterns that remove the secret VALUE, not just the word next to it. Upstream's word
// patterns turned `password=Hunter2!x` into `[REDACTED]=Hunter2!x`. These run before everything else, so
// the word is still there to match; the whole `name=value` / `name: value` pair is replaced.
export const VALUE_REDACTION_PATTERNS: readonly RegExp[] = Object.freeze([
  /bearer\s+\S+/i,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/, // JWT
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key id
  /(?:api[_-]?key|app[_-]?key|authorization|passw(?:or)?d|secret|token)[\w-]*["']?\s*[:=]\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&}]+)/i, // quoted values may contain escaped quotes
]);

function sanitizeText(text: string, patterns: readonly RegExp[]): string {
  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

// Selerix change: walk nested arrays/objects too. Upstream only cleaned top-level strings, so a value
// inside e.g. `datadogError: [...]` was returned unredacted.
// Selerix change: a structured error can hold `{ "password": "Hunter2" }`, where the secret word is the KEY
// and the value alone ("Hunter2") has nothing to match. A value under a secret-looking key is replaced whole.
const SENSITIVE_KEY = /api[_-]?key|app[_-]?key|authorization|passw(?:or)?d|secret|token/i;

function sanitizeValue(value: unknown, patterns: readonly RegExp[], key?: string): unknown {
  if (key !== undefined && SENSITIVE_KEY.test(key) && value !== null && value !== undefined && typeof value !== "boolean") {
    return "[REDACTED]";
  }
  if (typeof value === "string") return sanitizeText(value, patterns);
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, patterns));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeValue(v, patterns, k)]),
    );
  }
  return value;
}

function sanitizeStructured(data: StructuredError, patterns: readonly RegExp[]): StructuredError {
  const out: StructuredError = { message: sanitizeText(data.message, patterns) };
  for (const [key, value] of Object.entries(data)) {
    if (key === "message") continue;
    out[key] = sanitizeValue(value, patterns, key);
  }
  return out;
}

// Selerix change: value-aware patterns run first, then caller patterns, so an exact secret value is removed
// whole before the generic word patterns (api key, token, ...) can partially match inside it.
function buildPatterns(opts: CreateWrapToolHandlerOptions): RegExp[] {
  // Also global: without the g flag only the first match in a text was replaced, so a second
  // "Bearer <value>" or a repeated word stayed visible.
  return [...VALUE_REDACTION_PATTERNS, ...(opts.redactionPatterns ?? []), ...DEFAULT_REDACTION_PATTERNS].map((p) =>
    p.flags.includes("g") ? p : new RegExp(p.source, p.flags + "g"),
  );
}

/**
 * Selerix addition: the same redaction as the wrapper, for text that is returned as data instead of
 * thrown (per-item errors, caveat lists), which the wrapper's error path never sees.
 */
export function createTextSanitizer(opts: CreateWrapToolHandlerOptions = {}): (text: string) => string {
  const patterns = buildPatterns(opts);
  return (text: string) => sanitizeText(text, patterns);
}

/** Build a wrapToolHandler tailored to a consumer MCP server. */
export function createWrapToolHandler(opts: CreateWrapToolHandlerOptions = {}) {
  const patterns = buildPatterns(opts);
  const extractors = opts.errorExtractors ?? [];
  const fieldParam = opts.extractFieldsParam ?? "extractFields";

  return function wrapToolHandler<T>(
    fn: (params: T) => Promise<unknown>,
  ): (params: T) => Promise<ToolTextResult> {
    return async (params: T): Promise<ToolTextResult> => {
      try {
        const result = await fn(params);
        const expr = (params as Record<string, unknown> | undefined)?.[fieldParam];
        const projected = typeof expr === "string" ? applyExtractFields(result, expr) : result;
        return {
          content: [{ type: "text", text: JSON.stringify(projected, null, 2) }],
        };
      } catch (error) {
        for (const ex of extractors) {
          if (!ex.match(error)) continue;
          const handling = ex.extract(error);
          if (handling.kind === "passthrough") {
            return {
              content: [{ type: "text", text: handling.text }],
              isError: true,
            };
          }
          const data = handling.sanitize === false
            ? handling.data
            : sanitizeStructured(handling.data, patterns);
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
            isError: true,
          };
        }
        const fallback = {
          message: error instanceof Error
            ? sanitizeText(error.message, patterns)
            : sanitizeText(String(error), patterns),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(fallback, null, 2) }],
          isError: true,
        };
      }
    };
  };
}

/** Default-configured wrapper — uses only built-in redaction patterns. */
export const wrapToolHandler = createWrapToolHandler();
