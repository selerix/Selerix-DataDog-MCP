/**
 * Derive MCP tool annotations (readOnlyHint / destructiveHint / openWorldHint)
 * from a tool's kebab-case name, so every tool advertises the standard hints
 * from a single place instead of being hand-annotated.
 *
 * Strategy — conservative by construction:
 *   - Default is read-only. Only a curated set of mutating verbs flips
 *     `readOnlyHint` to false. A tool whose verb is not in the lists below is
 *     therefore advertised as read-only, so new write verbs must be added to
 *     WRITE_VERBS (or passed as an explicit `overrides` object at the call site).
 *   - `openWorldHint` is true for all tools — they talk to external systems.
 *   - The hints are advisory; clients must not make security-critical decisions on them alone.
 */
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type { ToolAnnotations };

const NAMESPACE_PREFIXES = new Set([
  "dbt",
  "airflow",
  "dq",
  "docs",
  "sheets",
  "slides",
]);

/** Verbs that mutate state → readOnlyHint:false. */
const WRITE_VERBS = new Set([
  // generic CRUD + lifecycle
  "create", "update", "delete", "set", "add", "remove", "run", "trigger",
  "clear", "cancel", "restore", "rename", "transition", "finalize", "suggest",
  "log", "test", "mute", "unmute", "publish", "unpublish", "send", "post",
  "install", "uninstall", "apply", "enable", "disable", "start", "stop",
  "reboot", "mark", "rotate", "configure", "upgrade", "deploy", "schedule",
  "resolve", "complete", "execute", "write", "put", "patch",
  // document / spreadsheet / slides mutations
  "insert", "replace", "append", "merge", "unmerge", "duplicate", "move",
  "copy", "share", "resize", "sort", "format", "protect", "manage",
  // device / UI control
  "connect", "disconnect", "grant", "revoke", "change", "toggle", "load",
  "save", "launch", "lock", "unlock", "keep", "port", "reverse", "tap",
  "swipe", "scroll", "push", "pull", "input", "broadcast", "press", "drag",
  "drop", "type", "fill", "navigate", "edit", "open", "close", "double",
  "long", "click", "hover",
  // collaboration
  "invite", "join", "leave", "kick", "archive", "unarchive", "bookmark",
  "pin", "react",
]);

/** Subset of writes that may destroy or remove data → destructiveHint:true. */
const DESTRUCTIVE_VERBS = new Set([
  "delete", "remove", "uninstall", "clear", "cancel", "drop", "purge",
  "reset", "revoke", "kick", "archive", "unpublish", "wipe",
]);

/** Extract the meaningful verb from a kebab-case tool name. */
export function toolVerb(name: string): string {
  let parts = name.toLowerCase().split("-").filter(Boolean);
  if (parts.length > 1 && NAMESPACE_PREFIXES.has(parts[0])) {
    parts = parts.slice(1);
  }
  if (parts.length > 1 && parts[0] === "batch") {
    parts = parts.slice(1); // batch-update-values → update
  }
  return parts[0] ?? "";
}

// Selerix change: true when the tool's name verb marks it as a write (the same test that drives readOnlyHint).
export function isWriteTool(name: string): boolean {
  return WRITE_VERBS.has(toolVerb(name));
}

/**
 * Infer a tool's annotations from its name. `overrides` are merged last and win,
 * so a call site can correct any misclassification field-by-field.
 */
export function inferToolAnnotations(name: string, overrides: ToolAnnotations = {}): ToolAnnotations {
  const verb = toolVerb(name);
  const isWrite = WRITE_VERBS.has(verb);
  const annotations: ToolAnnotations = {
    readOnlyHint: !isWrite,
    openWorldHint: true,
  };
  if (isWrite && DESTRUCTIVE_VERBS.has(verb)) {
    annotations.destructiveHint = true;
  }
  return { ...annotations, ...overrides };
}
