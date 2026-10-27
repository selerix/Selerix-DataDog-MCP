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
pnpm run token-stats  # measures tool-schema token size; fails above TOKEN_BUDGET (env, else a TOKEN_BUDGET line in .env, else no check; CI: repo variable TOKEN_BUDGET, default 35000)
node dist/index.js    # run the server
```

Config comes from env / `.env` (copy `.env.example`): `DD_API_KEY`, `DD_APP_KEY` (both required, validated at startup), `DD_SITE` (default `us5.datadoghq.com` — set it to match the org's site), `DD_ALLOW_WRITE`, `DD_TOOLS` / `DD_DISABLE` (comma-separated category allow/deny lists), `MCP_TRANSPORT=http` + `MCP_HTTP_TOKEN` for Streamable HTTP instead of stdio. `tests/setup.ts` injects fake keys, because `config.ts` reads env at import time.

## Architecture

Request path: MCP client -> `src/index.ts` -> `src/tools/<category>.ts` -> shared SDK clients in `src/client.ts` -> Datadog.

- `src/index.ts` (~1500 lines) is the only place tools are registered. A module-level `currentCategory` variable is set before each block of `tool(name, description, schema.shape, wrapToolHandler(fn))` calls; the local `tool()` helper registers the name in the `ToolRegistry` (`src/tool-registry.ts`), and only calls `server.tool` if that category is enabled. When adding a tool, you must put it under the right `currentCategory = "..."` line, otherwise it is filtered under the wrong `DD_TOOLS`/`DD_DISABLE` category. New categories must be added to `CATEGORIES` in `tool-registry.ts`.
- Each tool file exports a zod schema (`zod/v4`, `.describe()` on every field — the model reads them) plus an async handler returning a trimmed object, not the raw SDK response. Several read tools also get default field slimming via `src/tools/extract-fields.ts`.
- `src/tools/utils.ts`: `wrapToolHandler` (from the vendored toolkit) handles error shaping and redacts the API/app keys. Write tools must call `assertWriteAllowed()` first; it throws `WriteBlockedError` unless `DD_ALLOW_WRITE=true`. Writes are off by default, so a "write blocked" error is expected until you set that.
- `inferToolAnnotations` (toolkit) derives `readOnlyHint`/`destructiveHint` from the tool name, so tool names should follow the existing `list-/get-/search-` vs `create-/update-/delete-` verbs. `tests/integration/tool-registration.test.ts` mocks `McpServer`, asserts the full `EXPECTED_TOOLS` list and annotations — update that list when adding or removing a tool.
- `src/resources.ts` (`dd://...` URIs), `src/prompts.ts`, `src/tools/aggregations.ts` (multi-call summaries such as `analyze-monitor-state`, `slo-compliance-snapshot`, `incident-triage-snapshot`) and `src/ui/*.html` (ChatGPT/Apps SDK card templates) sit alongside the plain API-wrapper tools.
- The plumbing (registry, wrapper, annotations, transport bootstrap, `aggregate()`, `applyExtractFields`) is `src/vendor/mcp-toolkit/`, a vendored TypeScript transcription of `@us-all/mcp-toolkit` 1.3.0 (MIT, its `LICENSE` is alongside; keep it). It is no longer an npm dependency, so edit it directly here. Import it via `vendor/mcp-toolkit/index.js` (`startMcpServer` from `runtime.js`). `annotations.ts` treats any verb not in `WRITE_VERBS` as read-only, so add the verb there when you introduce a new kind of write tool. Selerix changes to the vendored code (marked "Selerix change" in comments): error redaction walks nested arrays/objects, and caller patterns run before the generic word patterns. In `runtime.ts` the HTTP transport's localhost `Host` allowlist brackets IPv6 literals (`[::1]:port`), which upstream got wrong for an IPv6 bind host (every request was rejected with 403). `tools/utils.ts` passes the configured `DD_API_KEY`/`DD_APP_KEY` **values** (via `secretValuePatterns`, values of 8+ characters) so a key echoed in an error is removed, not just the variable name; the generic patterns still blank words such as `token` in error text.

### SDK gotcha

For v2 aggregate/search request bodies (e.g. `aggregate-logs`, `aggregate-rum`), build SDK model instances (`new v2.LogsAggregateRequest()`, `new v2.LogsCompute()`). Plain objects cast with `as any` skip `ObjectSerializer` field mapping (`groupBy` -> `group_by`) and Datadog returns 400. The v1 synthetics code in this repo passes plain objects (with `as any`) and was not observed failing, but it hasn't been verified against a live account here.

### Datadog client is pinned to `~1.59.0` (decision: stay on it)

Do not bump `@datadog/datadog-api-client` past 1.59.x without doing the work below. Tried 1.64.0: the build fails with 16 type errors, all in `src/tools/fleet.ts`, because nine Fleet Automation methods (and their model classes) were renamed to `...V2` (`listFleetAgentsV2`, `listFleetAgentVersionsV2`, `listFleetDeploymentsV2`, `getFleetDeploymentV2`, `listFleetSchedulesV2`, `getFleetScheduleV2`, `createFleetDeploymentConfigureV2`, `createFleetDeploymentUpgradeV2`, `cancelFleetDeploymentV2`); 1.64 also lists a different set of "unstable operation" keys than the ones in `client.ts`. The Synthetics read tools and the dry runs worked against 1.64 (checked live); real saves were not tried on it. The tilde range matters: a published package has no lockfile, so a caret range would give consumers the newest 1.x and break the fleet tools at runtime. To move up later, either migrate `fleet.ts` to the V2 methods (the fleet write tools act on live agents, so they need a non-production agent to test) or remove the 15 fleet tools, then re-run the build, tests and a live Synthetics check.

## Synthetics: API tests vs browser tests (the fork's reason to exist)

Upstream's `src/tools/synthetics.ts` (`get-synthetics-result`, `create/update-synthetics-test`) is **API-test-only** (`getAPITest*`, `type: "api"`); `list-synthetics`, `trigger-synthetics` and `delete-synthetics-test` use type-agnostic endpoints and work for browser tests too (list verified live; trigger and delete not exercised).

Selerix additions live in `src/tools/synthetics-browser.ts` (registered in the same `"synthetics"` category block of `index.ts`):

- Browser tests: `get-synthetics-browser-test`, `get-synthetics-browser-results`, `get-synthetics-browser-result`, `update-synthetics-browser-test`, `create-synthetics-browser-test` (from a start URL plus raw step objects such as `{"type":"goToUrl","params":{"value":url}}` and `{"type":"wait","params":{"value":5}}`; created **paused** by default, `dryRun` supported). Deleting uses the type-agnostic `delete-synthetics-test`. Pausing/scheduling uses `set-synthetics-test-status` (`status: live|paused`, one or more test IDs, any test type): it calls Datadog's dedicated status endpoint, so unlike `update-synthetics-browser-test` it does not rewrite the test or regenerate step IDs. Name write tools with a verb from `WRITE_VERBS` (e.g. `set-`, not `pause-`), otherwise they are advertised as read-only.
- Global variables: `list-synthetics-global-variables`, `get-synthetics-global-variable`, `edit-synthetics-global-variable`. No create/delete.
- `update-synthetics-browser-test` supports `dryRun` (needs no `DD_ALLOW_WRITE`), `stepUpdates` (per-step edits; params are shallow-merged; step chosen by `index` or step `publicId`), full `steps` replacement, and `configVariables`/`variables` replacement. Datadog's PUT replaces the whole test, so the tool fetches the current test and merges. If the GET returns zero steps (seen for 1 of 25 sampled tests) it refuses to save unless `steps` is passed, to avoid wiping the recording. Datadog rejects the read-only step `publicId` on update (HTTP 400, `'public_id' was unexpected`), so the tool strips it (`withoutReadOnlyStepFields`); as a result **every save gives all steps new public IDs** (seen live: all 52 changed), and Datadog trims trailing whitespace from the test name. Step contents, order, options, variables, tags and locations came back identical. The get-merge-save sequences of `update-synthetics-browser-test` and `edit-synthetics-global-variable` run under `withLock` (per test / per variable), so overlapping calls in one server cannot overwrite each other; edits made elsewhere (e.g. the Datadog UI) are not covered because the API has no revision check.
- Datadog never returns secure global-variable values, so `edit-synthetics-global-variable` requires `value` for secure variables. Non-secure values are returned in clear by `get-synthetics-global-variable`; none of the org's 10 global variables was marked secure when checked.

The read tools and the dry run were verified live against the Selerix org, and one real `update-synthetics-browser-test` save (flipping `allowFailure`/`isCritical` on one step of a live regression test) was verified by diffing the test before and after. `create-synthetics-browser-test` and `delete-synthetics-test` were verified live by creating a paused two-step throwaway test, reading it back, deleting it and confirming the lookup returned 404 and the org's test count was unchanged. The app key used there cannot read monitors (403), so the deletion of the test's auto-created monitor was not verified. `set-synthetics-test-status` was verified live on a paused weekly test (paused -> live -> paused; steps, step IDs, name and schedule unchanged; the test's `modified_at` does change). `edit-synthetics-global-variable` and `trigger-synthetics` have not been exercised. Not covered: creating/deleting global variables, mobile tests.

New tools go in `index.ts` under the right `currentCategory` and into `EXPECTED_TOOLS` (also bump the count assertion in `tool-registration.test.ts`). `pnpm run token-stats` reports ~31.6k tokens for the full 173-tool default set; the `TOKEN_BUDGET` guard in `ci.yml` was raised from upstream's 30000 to 35000 for the Selerix tools. To raise it again without a code change, set the GitHub repo variable `TOKEN_BUDGET` (`ci.yml` uses `vars.TOKEN_BUDGET || 35000`); it only affects CI and developers, not people running the published server. The script ignores a local `.env` `DD_TOOLS`/`DD_DISABLE` when measuring the default set.

## Docs that go stale

`README.md`, `package.json` description, `CHANGELOG.md`, the `registry` description string in `tool-registry.ts` and `server.json` all quote a tool count (158 / 159 / 163 / 165 / 166 appear in different places). Treat `EXPECTED_TOOLS` in the registration test as the source of truth and don't copy a count into new docs. `CONTRIBUTING.md` says Node 18+ and uses the older `server.tool(...)` registration example; the Node requirement in `package.json` and the `tool()` helper in `index.ts` are what actually apply. `PLAN.md`, `STANDARD.md` (a redirect to the toolkit repo) and `OSS_SECURITY_FINAL_REPORT.md` are upstream project artefacts.

## CI

`.github/workflows/ci.yml` runs on Node 22: `pnpm install --frozen-lockfile`, build, tests, token-stats guard, plus a gitleaks secret scan. Commit `pnpm-lock.yaml` changes with any dependency edit, because `--frozen-lockfile` fails otherwise. Upstream's `npm-publish.yml` and `docker-publish.yml` (public npm / GHCR on `v*` tags) are disabled by renaming them to `*.yml.disabled`; releases are done manually with `npm publish`, which `publishConfig.registry` in `package.json` sends to the Selerix Azure Artifacts feed (`@selerix` scope, same registry as in the maintainer's `~/.npmrc`). `npm publish` does not build, so run `pnpm run build` first. The package is `@selerix/datadog-mcp` (renamed from `@us-all/datadog-mcp`); `README.md`, `CONTRIBUTING.md`, `server.json`'s `name` and `package.json`'s `mcpName` still carry upstream's `us-all` identity.
