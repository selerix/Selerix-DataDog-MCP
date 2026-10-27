# Releasing `@selerix/datadog-mcp`

Status at 1.22.0 (prepared 2026-10-26): **ready to publish once the organization security review approves. Nothing has been published or tagged.**

## Release facts

| | |
|--|--|
| Package | `@selerix/datadog-mcp` 1.22.0 (first Selerix release; based on upstream `us-all/datadog-mcp-server` 1.21.1, MIT) |
| Target registry | Selerix Azure Artifacts: `https://pkgs.dev.azure.com/selerix/_packaging/Selerix/npm/registry/` (set by `publishConfig.registry`) |
| Tarball | ~213 files, ~135 KB packed, only `dist/`, `README.md`, `LICENSE`, `server.json`, `package.json`. No `.env`, tests, workflows or source |
| Runtime | Node 22+, MCP over stdio by default |
| Tools | 175 (Synthetics browser-test, pause/schedule and global-variable tools added) |

## Security review summary

**What it does.** A local MCP server that calls the Datadog API (the site in `DD_SITE`) with the API and application keys it is given, and exposes the results as tools to an MCP client such as Claude.

**Network and processes.** The server makes requests only to the Datadog API through the official `@datadog/datadog-api-client`. The optional HTTP transport is off by default (`MCP_TRANSPORT=http` enables it); it binds to `127.0.0.1`, needs a bearer token (`MCP_HTTP_TOKEN`) and enables DNS-rebinding protection for localhost. The vendored toolkit code contains no child-process, eval or file-write code. The package has no install scripts.

**Credentials.** `DD_API_KEY` / `DD_APP_KEY` come from the environment or a git-ignored `.env`. Error text is redacted: the configured key values are removed (not just the variable names), nested error fields are covered, error text that tools return as data (per-test errors, aggregation caveats) goes through the same redaction, and the generic patterns (`token`, `password`, `secret`, ...) are applied after. CI runs a gitleaks secret scan. The app key's permissions bound what the server can do, so use a scoped key (a service account limited to the Synthetics read/write and global-variable permissions should be enough for the Synthetics tools; this was not tested with a restricted key).

**Writes are opt-in.** Nothing that changes Datadog runs unless `DD_ALLOW_WRITE=true`. Tools carry MCP annotations (`readOnlyHint` / `destructiveHint`) derived from their names; a unit test asserts them. `update-synthetics-browser-test` and `create-synthetics-browser-test` also support `dryRun`, which needs no write flag. `DD_TOOLS=synthetics` limits the server to the Synthetics tools.

**Dependencies (production).**
- Direct: `@datadog/datadog-api-client` `~1.59.0`, `@modelcontextprotocol/sdk` `^1.32.2`, `dotenv` `^17.4.2`, `zod` `^4.6.7`.
- 111 packages in the production tree. Licenses: MIT 97, ISC 7, BSD-2-Clause 3, BSD-3-Clause 2, Apache-2.0 1 (the Datadog client), MIT AND Zlib 1. No copyleft, no unknown licenses.
- Vulnerabilities: **0** by `pnpm audit --prod` and by `npm audit --omit=dev` in a clean install of the packed tarball (2026-10-26). Before this release the audit reported 49 advisories (1 critical, 16 high), all in `@modelcontextprotocol/sdk` 1.29.0, `zod` 4.4.2 and the SDK's transitive web-server packages (express, hono, body-parser, ip-address, fast-uri, ...); they were resolved by updating within the existing ranges.
- The Datadog client is held at `~1.59.0` on purpose: newer releases rename the fleet-automation methods (`...V2`; 1.64.0 was tried and `pnpm build` failed in `src/tools/fleet.ts`). A published package has no lockfile, so the range itself has to hold this.
- `@us-all/mcp-toolkit` 1.3.0 is vendored in `src/vendor/mcp-toolkit/` (MIT, license included) instead of being an npm dependency. It was transcribed from the package's compiled output; the original and the copy returned identical results on 85 comparison cases. Selerix changes to it are marked "Selerix change" in comments (nested redaction, caller patterns first, and for the optional HTTP transport an IPv6 host allowlist and a fresh transport per request).

**Known limitations a reviewer should know about**
- Global variables that are not marked secure in Datadog are returned in clear by `get-synthetics-global-variable` (at the last check none of the org's 10 global variables was marked secure). Datadog never returns secure values.
- Saving a browser test through `update-synthetics-browser-test` makes Datadog assign new IDs to all of its steps and trim trailing whitespace from its name. `set-synthetics-test-status` (pause/schedule) does not.
- Setting a paused test live runs it immediately (seen once, within a second).
- Locks protect against overlapping edits inside one server process only; edits made elsewhere (for example in the Datadog UI) between a read and a save can be overwritten, because the API has no revision check.
- Deleting a Synthetics test also deletes its monitor in Datadog, but this could not be verified because the app key used for testing cannot read monitors.
- In the optional HTTP mode (`MCP_TRANSPORT=http`, off by default) requests are processed one at a time, so a slow tool call delays other clients. A request that runs longer than 10 minutes is cut off so a hung call cannot block the others. stdio is the default and the intended mode.
- Redaction removes the configured key values and common secret words; it is not a general data-loss-prevention filter, and tool results (as opposed to errors) are returned as Datadog sends them.
- The package's own dependencies come from public npm. The Azure feed needs npmjs as an upstream source, or consumers need access to public npm.

## Before publishing (pending review)

1. Security review approved.
2. PR into `main` merged with CI green.
3. Versions agree: `package.json`, `server.json` (two fields; a unit test fails if they drift) and `CHANGELOG.md`.
4. From a clean checkout of `main`:
   ```bash
   pnpm install --frozen-lockfile
   pnpm test
   pnpm audit --prod
   npm pack --dry-run
   ```
   `npm pack` and `npm publish` run `prepack`, which rebuilds `dist/`, so output cannot be stale.

## Publish

```bash
npm publish
```

Authentication is whatever the Azure Artifacts entries in your `~/.npmrc` provide. The registry comes from `publishConfig`. No GitHub workflow publishes (the upstream npm and container publish workflows are disabled as `*.yml.disabled`), so pushing a tag does not publish.

## After publishing

1. Confirm the version is in the feed (Azure Artifacts, or `npm view @selerix/datadog-mcp version --registry https://pkgs.dev.azure.com/selerix/_packaging/Selerix/npm/registry/`).
2. In an empty folder, install it from the feed, run `npm audit --omit=dev`, start `node_modules/@selerix/datadog-mcp/dist/index.js` over stdio with placeholder keys and confirm it reports `datadog` 1.22.0 and 175 tools.
3. Tag the release: `git tag v1.22.0 && git push origin v1.22.0`.
4. If something is wrong, deprecate the version in the feed and publish a fixed patch version rather than reusing the number.

## Reproducing the checks

```bash
pnpm audit --prod
pnpm licenses list --prod
TOKEN_BUDGET=35000 node scripts/measure-tokens.mjs   # after pnpm build
```
