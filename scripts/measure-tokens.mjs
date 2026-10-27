#!/usr/bin/env node
// Measure MCP tool schema token cost.
// Boots the server, sends tools/list, reports estimated tokens.
// Usage: pnpm build && pnpm token-stats

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, "..", "dist", "index.js");

// Empty DD_TOOLS/DD_DISABLE stop a local .env (which the server loads) from narrowing the "default" scenario.
const BASE_ENV = { DD_API_KEY: "x", DD_APP_KEY: "x", DD_TOOLS: "", DD_DISABLE: "" };

// TOKEN_BUDGET: process env wins (CI sets it), then a TOKEN_BUDGET line in the repo's .env, else 0 (no guard).
// Only that one key is read from .env so the rest of a developer's settings stay out of this script.
function resolveBudget() {
  if (process.env.TOKEN_BUDGET !== undefined) return Number(process.env.TOKEN_BUDGET);
  try {
    const parsed = dotenv.parse(readFileSync(path.resolve(__dirname, "..", ".env")));
    if (parsed.TOKEN_BUDGET !== undefined) return Number(parsed.TOKEN_BUDGET);
  } catch {}
  return 0;
}

const SCENARIOS = [
  { label: "default", env: {} },
  { label: "narrow (metrics,monitors)", env: { DD_TOOLS: "metrics,monitors" } },
  { label: "typical (metrics,monitors,logs,apm,dashboards)", env: { DD_TOOLS: "metrics,monitors,logs,apm,dashboards" } },
];

function estimateTokens(text) {
  return Math.round(text.length / 4);
}

function measure(envOverlay) {
  const init = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tok", version: "1" } },
  });
  const initialized = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
  const list = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  const result = spawnSync("node", [SERVER_ENTRY], {
    input: `${init}\n${initialized}\n${list}\n`,
    timeout: 15000,
    env: { ...process.env, ...BASE_ENV, ...envOverlay },
    encoding: "utf8",
  });

  for (const line of (result.stdout ?? "").split("\n").filter(Boolean)) {
    try {
      const msg = JSON.parse(line);
      if (msg.id === 2 && msg.result?.tools) {
        const j = JSON.stringify(msg.result.tools);
        return { count: msg.result.tools.length, bytes: j.length, tokens: estimateTokens(j) };
      }
    } catch {}
  }
  return { error: "no tools/list response", stderr: (result.stderr ?? "").slice(0, 200) };
}

console.log("scenario,toolCount,jsonBytes,estTokens,vsDefault");
let baseline = null;
let exitCode = 0;
for (const { label, env } of SCENARIOS) {
  const r = measure(env);
  if (r.error) {
    console.error(`${label},ERROR,${r.error}`);
    exitCode = 1;
    continue;
  }
  if (baseline === null) baseline = r.tokens;
  const reduction = baseline > 0 ? Math.round(((baseline - r.tokens) / baseline) * 100) : 0;
  const vs = env && Object.keys(env).length > 0 ? `-${reduction}%` : "—";
  console.log(`${label},${r.count},${r.bytes},${r.tokens},${vs}`);
}

// Regression guard: fail CI if default tokens grow unexpectedly.
// Threshold comes from TOKEN_BUDGET (env or .env; max acceptable default tokens).
const budget = resolveBudget();
if (Number.isNaN(budget)) {
  console.error("\n❌ TOKEN_BUDGET is not a number");
  exitCode = 1;
} else if (budget > 0 && baseline > budget) {
  console.error(`\n❌ default schema tokens (${baseline}) exceed TOKEN_BUDGET=${budget}`);
  exitCode = 2;
}
process.exit(exitCode);
