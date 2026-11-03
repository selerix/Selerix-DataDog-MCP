/**
 * Which write tools may run. Used twice: at registration (a write tool that is not allowed is never
 * advertised) and in `assertWriteAllowed()` (defence in depth for a handler called directly).
 *
 * Decision for existing setups: `DD_ALLOW_WRITE=true` keeps working and enables every write tool EXCEPT
 * the categories in `WRITE_OPT_IN_CATEGORIES`, which act on live agents, security rules and public status
 * pages. Those need an explicit `DD_WRITE_TOOLS` entry even when `DD_ALLOW_WRITE=true`.
 */

export const WRITE_OPT_IN_CATEGORIES: readonly string[] = ["fleet", "security", "status-pages"];

/**
 * Write tools whose `dryRun: true` previews never change anything and need no write permission. They stay
 * advertised when writes are off, so an edit can still be previewed; a real save is refused by the handler's
 * own `assertWriteAllowed()`.
 */
export const DRY_RUN_PREVIEW_TOOLS: readonly string[] = ["update-synthetics-browser-test", "create-synthetics-browser-test"];

/** `DD_WRITE_TOOLS` token that allows every write tool, opt-in categories included. */
export const WRITE_ALL_TOKEN = "all";

export interface WritePolicyConfig {
  allowWrite: boolean;
  /** Lowercase categories and/or tool names from DD_WRITE_TOOLS; null when unset. */
  writeTools?: string[] | null;
}

/**
 * When `DD_WRITE_TOOLS` is set it is the whole policy (it replaces `DD_ALLOW_WRITE`), so it can only narrow
 * or widen writes explicitly: tokens are category names, tool names, or `all`.
 */
export function isWriteToolAllowed(cfg: WritePolicyConfig, tool: string, category: string): boolean {
  const list = cfg.writeTools;
  if (list && list.length > 0) {
    return list.includes(WRITE_ALL_TOKEN) || list.includes(category) || list.includes(tool.toLowerCase());
  }
  return cfg.allowWrite && !WRITE_OPT_IN_CATEGORIES.includes(category);
}

/** True when any write at all may be enabled, for the "writes are disabled" wording of the error. */
export function writesConfigured(cfg: WritePolicyConfig): boolean {
  return cfg.allowWrite || (cfg.writeTools?.length ?? 0) > 0;
}
