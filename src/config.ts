import dotenv from "dotenv";

// quiet: dotenv 17 prints an "injected env" banner to stdout, which must carry only MCP protocol messages.
dotenv.config({ quiet: true });

function parseList(raw: string | undefined): string[] | null {
  if (!raw) return null;
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export const config = {
  apiKey: process.env.DD_API_KEY ?? "",
  appKey: process.env.DD_APP_KEY ?? "",
  site: (process.env.DD_SITE ?? "us5.datadoghq.com").trim().toLowerCase(), // what is validated is what is used
  allowWrite: process.env.DD_ALLOW_WRITE === "true",
  // Categories and/or tool names whose write tools are enabled; replaces DD_ALLOW_WRITE when set (see write-policy.ts).
  writeTools: parseList(process.env.DD_WRITE_TOOLS),
  // all | writes | off: which tool calls are logged to stderr (see audit.ts). Default: writes.
  auditLog: (process.env.DD_AUDIT_LOG ?? "writes").trim().toLowerCase(),
  enabledCategories: parseList(process.env.DD_TOOLS),
  disabledCategories: parseList(process.env.DD_DISABLE),
};

// The SDK sends both keys to https://api.<DD_SITE>, so an unexpected value would send them to another host.
export const ALLOWED_DD_SITES = [
  "datadoghq.com",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "ap1.datadoghq.com",
  "ap2.datadoghq.com",
  "datadoghq.eu",
  "ddog-gov.com",
] as const;

export function validateConfig(): void {
  if (!["all", "writes", "off"].includes(config.auditLog)) {
    // Fail closed: a typo such as "of" must not silently leave the audit trail in an unexpected state.
    throw new Error(`DD_AUDIT_LOG "${config.auditLog}" is not valid. Allowed: all, writes, off`);
  }
  if (!(ALLOWED_DD_SITES as readonly string[]).includes(config.site)) {
    throw new Error(
      `DD_SITE "${config.site}" is not an official Datadog site. Allowed: ${ALLOWED_DD_SITES.join(", ")}`,
    );
  }
  if (!config.apiKey) {
    throw new Error("DD_API_KEY environment variable is required");
  }
  if (!config.appKey) {
    throw new Error("DD_APP_KEY environment variable is required");
  }
}
