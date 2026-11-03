/**
 * Vendored copy of @us-all/mcp-toolkit 1.3.0 (MIT, Copyright (c) 2026 us-all) — see ./LICENSE.
 *
 * The npm package ships only compiled JS and type declarations, so these TypeScript
 * files are a faithful transcription of that output (same logic and public API).
 * Selerix owns this copy: edit it here instead of bumping an external dependency.
 *
 * `runtime.ts` is not re-exported here; import it from "./runtime.js" directly,
 * as the upstream package exposed it on a separate "/runtime" entry point.
 */
export { applyExtractFields, extractFieldsDescription } from "./extract-fields.js";
export {
  ToolRegistry,
  createSearchToolsMetaTool,
  parseEnvList,
  type ToolEntry,
  type RegistryConfig,
} from "./registry.js";
export {
  createWrapToolHandler,
  createTextSanitizer,
  wrapToolHandler,
  DEFAULT_REDACTION_PATTERNS,
  type CreateWrapToolHandlerOptions,
  type ToolCallInfo,
  type ErrorExtractor,
  type ErrorHandling,
  type StructuredError,
  type ToolTextResult,
} from "./wrap-tool-handler.js";
export { aggregate, defaultFormatReason, type Fetchers, type Aggregated } from "./aggregate.js";
export {
  startMcpServer,
  type StartMcpServerOptions,
  type TransportKind,
  type HttpHandle,
} from "./runtime.js";
export { inferToolAnnotations, isWriteTool, toolVerb, type ToolAnnotations } from "./annotations.js";
