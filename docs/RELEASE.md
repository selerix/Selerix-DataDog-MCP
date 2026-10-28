# Releasing `@selerix/datadog-mcp`

Status at 1.22.0 (prepared 2026-10-26, updated 2026-10-28): **ready to publish once the organization security review approves. Nothing has been published or tagged.**

## Release facts

| | |
|--|--|
| Package | `@selerix/datadog-mcp` 1.22.0 (first Selerix release; based on upstream `us-all/datadog-mcp-server` 1.21.1, MIT) |
| Target registry | Selerix Azure Artifacts: `https://pkgs.dev.azure.com/selerix/_packaging/Selerix/npm/registry/` (set by `publishConfig.registry`) |
| Tarball | ~225 files, ~159 KB packed, only `dist/`, `README.md`, `LICENSE`, `server.json`, `package.json`. No `.env`, tests, workflows or source |
| Runtime | Node 22+, MCP over stdio by default |
| Tools | 175 in total. With default settings (writes off) the server advertises 101: the read tools, `search-tools` and the two `dryRun`-capable browser-test tools. The other 74 write tools appear only when `DD_WRITE_TOOLS` / `DD_ALLOW_WRITE` allow them |
| Tests | 142 unit and integration tests |

## Security summary

**What it does.** A local MCP server that calls the Datadog API (the site in `DD_SITE`) with the API and application keys it is given, and exposes the results as tools to an MCP client such as Claude.

**Network and processes.** The server makes requests only to the Datadog API through the official `@datadog/datadog-api-client`, and `DD_SITE` must be one of the official Datadog sites or the server refuses to start (the keys are sent to `https://api.<DD_SITE>`). The optional HTTP transport is off by default (`MCP_TRANSPORT=http`). It listens on localhost only unless `MCP_HTTP_ALLOW_REMOTE=true` is set, needs a bearer token (`MCP_HTTP_TOKEN`, compared in constant time), accepts `MCP_HTTP_SKIP_AUTH` only on localhost, serves POST only, applies a Host-header allowlist (automatic for localhost, `MCP_HTTP_ALLOWED_HOSTS` otherwise) and returns a generic body for internal errors. The vendored toolkit code contains no child-process, eval or file-write code. The package has no install scripts.

**Credentials.** `DD_API_KEY` / `DD_APP_KEY` come from the environment or a git-ignored `.env`. Error text is redacted: the configured key values are removed (not just the variable names); the value after `password=`, `token:` and similar pairs, bearer values, JWTs and AWS key ids are removed whole, including quoted values with escaped quotes and every occurrence; structured error fields are covered, including values stored under keys such as `password` or `access_token`; error text that tools return as data (per-test errors, aggregation caveats) goes through the same redaction. CI runs a gitleaks secret scan. The app key's permissions bound what the server can do, so use a scoped key (a service account limited to the Synthetics read/write and global-variable permissions should be enough for the Synthetics tools; this was not tested with a restricted key).

**Writes are opt-in and scoped.** Nothing that changes Datadog runs by default. `DD_WRITE_TOOLS` takes categories and/or tool names (or `all`) and replaces `DD_ALLOW_WRITE` when set: an explicit `DD_WRITE_TOOLS` entry enables those writes even when `DD_ALLOW_WRITE` is false or unset, so `DD_ALLOW_WRITE=false` alone is not a read-only guarantee while `DD_WRITE_TOOLS` is present. With only `DD_ALLOW_WRITE=true`, the `fleet`, `security` and `status-pages` writes stay off. `DD_ALLOW_WRITE=true` still works but leaves the `fleet`, `security` and `status-pages` writes off; they need an explicit `DD_WRITE_TOOLS` entry. Write tools that are not allowed are not registered at all, so the model cannot see them or find them through `search-tools`. Each write handler also checks the policy with its own tool name and category when it runs, and a test cross-checks every such call against the registration. The exception is `create-` and `update-synthetics-browser-test`, which stay advertised so their `dryRun` previews work without write permission; their real saves are refused. Tools carry MCP annotations (`readOnlyHint` / `destructiveHint`) derived from their names, and a unit test asserts them. `DD_TOOLS=synthetics` limits the server to the Synthetics tools, and also hides the resources and `search-tools` entries of every other category.

**Limits on browser-test writes.** The browser-test create and update tools check what a call writes before anything is sent, also on a dry run: `assertFromJavascript`, `extractFromJavascript` and `runApiTest` steps are refused by default, only http(s) URLs are accepted, and private (`pl:`) locations are refused. `DD_BROWSER_STEP_TYPES` sets an explicit list of allowed step types (or `all`), `DD_BROWSER_URL_HOSTS` restricts start URLs and `goToUrl` steps to listed hosts and their subdomains, and `DD_ALLOW_PRIVATE_LOCATIONS=true` allows private locations. Steps already in a test are re-checked only when an edit changes their params.

**Audit log.** `DD_AUDIT_LOG` (`writes` by default, `all`, or `off`) writes one JSON line per tool call to stderr, never stdout: tool, category, read/write, outcome (`ok`, `error` or `blocked`), duration, the `dryRun` flag, and target ids such as `publicId` and `monitorId`. It never contains argument or result values, and error text in it is redacted. A `server_start` line lists the write tools the process exposes. A failing or closed stderr never affects a tool call or stops the server.

**Dependencies (production).**
- Direct: `@datadog/datadog-api-client` `~1.59.0`, `@modelcontextprotocol/sdk` `^1.32.2`, `dotenv` `^17.4.2`, `zod` `^4.6.7`.
- 111 packages in the production tree. Licenses: MIT 97, ISC 7, BSD-2-Clause 3, BSD-3-Clause 2, Apache-2.0 1 (the Datadog client), MIT AND Zlib 1. No copyleft, no unknown licenses.
- Vulnerabilities: **0** by `pnpm audit --prod` and by `pnpm audit` for the whole tree including development tools (2026-10-28); `npm audit --omit=dev` on a clean install of the packed tarball also reported 0 (2026-10-26, dependencies unchanged since). Before this release the audit reported 49 advisories in the production tree (1 critical, 16 high; `@modelcontextprotocol/sdk` 1.29.0, `zod` 4.4.2 and the SDK's transitive web-server packages), and 19 more in development tools (vite, vitest, `dd-trace`); they were resolved by updating within the existing ranges and by removing `dd-trace`.
- The Datadog client is held at `~1.59.0` on purpose: newer releases rename the fleet-automation methods (`...V2`; 1.64.0 was tried and `pnpm build` failed in `src/tools/fleet.ts`). A published package has no lockfile, so the range itself has to hold this.
- `@us-all/mcp-toolkit` 1.3.0 is vendored in `src/vendor/mcp-toolkit/` (MIT, license included) instead of being an npm dependency. It was transcribed from the package's compiled output; the original and the copy returned identical results on 85 comparison cases. Selerix changes to it are marked "Selerix change" in comments (value-aware and nested redaction, an `onCall` hook for the audit log, write-tool detection, discovery that respects category filters, and for the optional HTTP transport an IPv6 host allowlist, a fresh transport per request, POST only, constant-time token check and the localhost-only default).

**Build and supply chain.** GitHub Actions in CI are pinned to commit SHAs and the Docker base image to a digest; Dependabot proposes updates weekly for npm, github-actions and docker. The upstream workflows that published to public npm and a public container registry are disabled (`*.yml.disabled`), and the test step no longer sends test metadata to Datadog. No SAST step runs in CI yet: CodeQL needs GitHub Advanced Security on a private repository, so Semgrep or CodeQL is still to be added.

## Recommended configuration

For managing Synthetics tests, run over stdio with:

```
DD_TOOLS=synthetics
DD_WRITE_TOOLS=synthetics        # or leave writes off for read-only use
DD_BROWSER_URL_HOSTS=selerix.com # optional: keep test URLs on your own hosts
```

and a Datadog application key limited to the Synthetics read/write and global-variable scopes (no log, RUM or APM read scopes). The log, RUM and APM tools return production data, which can include member PII or PHI; without those categories and scopes the server cannot read it. Keep `DD_AUDIT_LOG` at its default and ship stderr to your log collector.

## Known limitations a reviewer should know about

- The log, RUM, APM and similar tools return Datadog data as it is, including any personal data in it. `DD_TOOLS` and a scoped key are the controls; there is no output filter. Whether such data may be sent to an AI client needs a data-classification decision.
- Global variables that are not marked secure in Datadog are returned in clear by `get-synthetics-global-variable` (at the last check none of the org's 10 global variables was marked secure). Datadog never returns secure values.
- Saving a browser test through `update-synthetics-browser-test` makes Datadog assign new IDs to all of its steps and trim trailing whitespace from its name. `set-synthetics-test-status` (pause/schedule) does not.
- Setting a paused test live runs it immediately (seen once, within a second).
- Locks protect against overlapping edits inside one server process only; edits made elsewhere (for example in the Datadog UI) between a read and a save can be overwritten, because the API has no revision check.
- Deleting a Synthetics test also deletes its monitor in Datadog, but this could not be verified because the app key used for testing cannot read monitors.
- The optional HTTP mode has one shared Datadog identity and one static token and handles requests one at a time (a request longer than 10 minutes is cut off). It is not offered as a shared service; stdio is the supported mode.
- Redaction removes the configured key values and common secret patterns; it is not a general data-loss-prevention filter, and tool results (as opposed to errors) are returned as Datadog sends them.
- Not exercised against live Datadog: editing a global variable, triggering a run, the write tools of the upstream tool set, and the browser-test limits and write scoping (covered by tests with a fake client).
- The package's own dependencies come from public npm. The Azure feed needs npmjs as an upstream source, or consumers need access to public npm.

## Before publishing (pending review)

1. Security review approved.
2. PR into `main` merged with CI green.
3. Versions agree: `package.json`, `server.json` (two fields; a unit test fails if they drift) and `CHANGELOG.md`.
4. From a clean checkout of `main`:
   ```bash
   pnpm install --frozen-lockfile
   pnpm test
   pnpm audit
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
2. In an empty folder, install it from the feed, run `npm audit --omit=dev`, start `node_modules/@selerix/datadog-mcp/dist/index.js` over stdio with placeholder keys and confirm it reports `datadog` 1.22.0 and 101 tools (175 with `DD_WRITE_TOOLS=all`).
3. Tag the release: `git tag v1.22.0 && git push origin v1.22.0`.
4. If something is wrong, deprecate the version in the feed and publish a fixed patch version rather than reusing the number.

## Reproducing the checks

```bash
pnpm audit
pnpm audit --prod
pnpm licenses list --prod
TOKEN_BUDGET=35000 node scripts/measure-tokens.mjs   # after pnpm build
```
