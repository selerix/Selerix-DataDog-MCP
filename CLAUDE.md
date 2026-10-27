# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Selerix fork of the MIT-licensed community `us-all/datadog-mcp-server`: an MCP server (stdio by default) that exposes Datadog APIs as tools through the official `@datadog/datadog-api-client`. Keep the upstream `LICENSE` and copyright notice intact.

Selerix's goal for the fork is managing Datadog **Synthetics browser tests** from Claude (explore tests, edit recordings/steps, edit variables, read results, trigger scheduled runs). See "Synthetics: API tests vs browser tests" below — the upstream code only covers API tests; the browser-test tools are Selerix additions.

## Commands

Requires Node >= 22 (`engines` in package.json; CI uses 22) and pnpm 10 (`packageManager` pins it). Use `pnpm`, not npm.

On the maintainer's Windows machine, pnpm crashes with `Cannot read properties of null (reading 'replace')` because `~/.npmrc` has a malformed `//registry = {...}` line. Work around it per shell with `NPM_CONFIG_USERCONFIG` pointing at an empty file (e.g. `$env:NPM_CONFIG_USERCONFIG = "<path>\empty.npmrc"; npx -y pnpm@10.30.2 <cmd>`), or fix that line in `~/.npmrc`.

```bash
pnpm install
pnpm run build        # tsc, then copies src/ui -> dist/ui (the copy is part of build; plain tsc is not enough)
pnpm run dev          # tsc --watch
pnpm test             # vitest run (tests/**/*.test.ts, forked pool)
pnpm vitest run tests/unit/utils.test.ts          # single file
pnpm vitest run -t "name fragment"                 # single test by name
pnpm run smoke        # live read-only calls against a real Datadog account; needs .env, builds first
pnpm run token-stats  # measures tool-schema token size; CI fails above TOKEN_BUDGET=30000
node dist/index.js    # run the server
```

Config comes from env / `.env` (copy `.env.example`): `DD_API_KEY`, `DD_APP_KEY` (both required, validated at startup), `DD_SITE` (default `us5.datadoghq.com` — set it to match the org's site), `DD_ALLOW_WRITE`, `DD_TOOLS` / `DD_DISABLE` (comma-separated category allow/deny lists), `MCP_TRANSPORT=http` + `MCP_HTTP_TOKEN` for Streamable HTTP instead of stdio. `tests/setup.ts` injects fake keys, because `config.ts` reads env at import time.

## Architecture

Request path: MCP client -> `src/index.ts` -> `src/tools/<category>.ts` -> shared SDK clients in `src/client.ts` -> Datadog.

- `src/index.ts` (~1500 lines) is the only place tools are registered. A module-level `currentCategory` variable is set before each block of `tool(name, description, schema.shape, wrapToolHandler(fn))` calls; the local `tool()` helper registers the name in the `ToolRegistry` (`src/tool-registry.ts`), and only calls `server.tool` if that category is enabled. When adding a tool, you must put it under the right `currentCategory = "..."` line, otherwise it is filtered under the wrong `DD_TOOLS`/`DD_DISABLE` category. New categories must be added to `CATEGORIES` in `tool-registry.ts`.
- Each tool file exports a zod schema (`zod/v4`, `.describe()` on every field — the model reads them) plus an async handler returning a trimmed object, not the raw SDK response. Several read tools also get default field slimming via `src/tools/extract-fields.ts`.
- `src/tools/utils.ts`: `wrapToolHandler` (from `@us-all/mcp-toolkit`) handles error shaping and redacts the API/app keys. Write tools must call `assertWriteAllowed()` first; it throws `WriteBlockedError` unless `DD_ALLOW_WRITE=true`. Writes are off by default, so a "write blocked" error is expected until you set that.
- `inferToolAnnotations` (toolkit) derives `readOnlyHint`/`destructiveHint` from the tool name, so tool names should follow the existing `list-/get-/search-` vs `create-/update-/delete-` verbs. `tests/integration/tool-registration.test.ts` mocks `McpServer`, asserts the full `EXPECTED_TOOLS` list and annotations — update that list when adding or removing a tool.
- `src/resources.ts` (`dd://...` URIs), `src/prompts.ts`, `src/tools/aggregations.ts` (multi-call summaries such as `analyze-monitor-state`, `slo-compliance-snapshot`, `incident-triage-snapshot`) and `src/ui/*.html` (ChatGPT/Apps SDK card templates) sit alongside the plain API-wrapper tools.
- Much of the plumbing (registry, wrapper, annotations, transport bootstrap, `aggregate()`) lives in the external `@us-all/mcp-toolkit` package, not in this repo. Behaviour changes there arrive via dependency bumps.

### SDK gotcha

For v2 aggregate/search request bodies (e.g. `aggregate-logs`, `aggregate-rum`), build SDK model instances (`new v2.LogsAggregateRequest()`, `new v2.LogsCompute()`). Plain objects cast with `as any` skip `ObjectSerializer` field mapping (`groupBy` -> `group_by`) and Datadog returns 400. The v1 synthetics code in this repo passes plain objects (with `as any`) and was not observed failing, but it hasn't been verified against a live account here.

## Synthetics: API tests vs browser tests (the fork's reason to exist)

Upstream's `src/tools/synthetics.ts` (`get-synthetics-result`, `create/update-synthetics-test`) is **API-test-only** (`getAPITest*`, `type: "api"`); `list-synthetics`, `trigger-synthetics` and `delete-synthetics-test` use type-agnostic endpoints and work for browser tests too (list verified live; trigger and delete not exercised).

Selerix additions live in `src/tools/synthetics-browser.ts` (registered in the same `"synthetics"` category block of `index.ts`):

- Browser tests: `get-synthetics-browser-test`, `get-synthetics-browser-results`, `get-synthetics-browser-result`, `update-synthetics-browser-test`.
- Global variables: `list-synthetics-global-variables`, `get-synthetics-global-variable`, `edit-synthetics-global-variable`. No create/delete.
- `update-synthetics-browser-test` supports `dryRun` (needs no `DD_ALLOW_WRITE`), `stepUpdates` (per-step edits; params are shallow-merged; step chosen by `index` or step `publicId`), full `steps` replacement, and `configVariables`/`variables` replacement. Datadog's PUT replaces the whole test, so the tool fetches the current test and merges. If the GET returns zero steps (seen for 1 of 25 sampled tests) it refuses to save unless `steps` is passed, to avoid wiping the recording.
- Datadog never returns secure global-variable values, so `edit-synthetics-global-variable` requires `value` for secure variables. Non-secure values are returned in clear by `get-synthetics-global-variable`; none of the org's 10 global variables was marked secure when checked.

The read tools and the dry run were verified live against the Selerix org; the actual save paths (`update-synthetics-browser-test` without `dryRun`, `edit-synthetics-global-variable`) have not been exercised. Not covered: creating browser tests, creating/deleting global variables, mobile tests.

New tools go in `index.ts` under the right `currentCategory` and into `EXPECTED_TOOLS` (also bump the count assertion in `tool-registration.test.ts`). `pnpm run token-stats` reports ~31.6k tokens for the full 173-tool default set, above the `TOKEN_BUDGET=30000` guard in `ci.yml`; raise the budget or trim descriptions before relying on CI.

## Docs that go stale

`README.md`, `package.json` description, `CHANGELOG.md`, the `registry` description string in `tool-registry.ts` and `server.json` all quote a tool count (158 / 159 / 163 / 165 / 166 appear in different places). Treat `EXPECTED_TOOLS` in the registration test as the source of truth and don't copy a count into new docs. `CONTRIBUTING.md` says Node 18+ and uses the older `server.tool(...)` registration example; the Node requirement in `package.json` and the `tool()` helper in `index.ts` are what actually apply. `PLAN.md`, `STANDARD.md` (a redirect to the toolkit repo) and `OSS_SECURITY_FINAL_REPORT.md` are upstream project artefacts.

## CI

`.github/workflows/ci.yml` runs on Node 22: `pnpm install --frozen-lockfile`, build, tests, token-stats guard, plus a gitleaks secret scan. Commit `pnpm-lock.yaml` changes with any dependency edit, because `--frozen-lockfile` fails otherwise. `npm-publish.yml` and `docker-publish.yml` are inherited from upstream (not reviewed here); check them before relying on them in the fork, since the package is still named `@us-all/datadog-mcp`.
