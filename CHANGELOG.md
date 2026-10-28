# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Scoped writes (`DD_WRITE_TOOLS`)** — a write allowlist of categories and/or tool names (or `all`), e.g. `DD_WRITE_TOOLS=synthetics` or `set-synthetics-test-status`. When set it replaces `DD_ALLOW_WRITE`.
- **Audit log (`DD_AUDIT_LOG=all|writes|off`, default `writes`)** — one JSON line per tool call on stderr: tool, category, read/write, outcome (`ok`/`error`/`blocked`), duration, `dryRun` flag and target ids (`publicId`, `monitorId`, ...). No argument or result values; error text is redacted. A `server_start` line lists the write tools exposed. An invalid value stops startup.

### Changed

- **Write tools that are not allowed are no longer registered**, so they are not advertised to the model or listed by `search-tools`. Before, all 76 were advertised and refused at call time. With default settings the server now exposes the read tools plus `search-tools` and the two `dryRun`-capable browser-test tools (`create-` and `update-synthetics-browser-test`, whose saves are still refused), 101 in all, instead of 175. An empty `DD_AUDIT_LOG` counts as unset.
- **`DD_ALLOW_WRITE=true` no longer enables the `fleet`, `security` and `status-pages` write tools.** They act on live agents, security rules and public status pages and now need an explicit `DD_WRITE_TOOLS` entry (e.g. `DD_WRITE_TOOLS=all`). Every other write category behaves as before.
- `assertWriteAllowed()` takes the tool name and category, so a handler invoked directly is held to the same policy as a registered one. `dryRun` previews still need no write permission.
- Vendored toolkit: `isWriteTool()` (annotations) and an `onCall` hook on the handler wrapper. `pnpm run token-stats` now measures the full tool set with `DD_WRITE_TOOLS=all`, plus a read-only scenario.

## [1.22.0] - 2026-10-26

First Selerix release. Based on upstream `us-all/datadog-mcp-server` 1.21.1.

### Added

- **Synthetics browser-test tools (8)** — `get-synthetics-browser-test`, `get-synthetics-browser-results`, `get-synthetics-browser-result`, `create-synthetics-browser-test`, `update-synthetics-browser-test` (per-step edits, full step replacement, config/local variables, `dryRun`), and `set-synthetics-test-status` (pause / schedule any test without rewriting it).
- **Synthetics global-variable tools (3)** — `list-synthetics-global-variables`, `get-synthetics-global-variable`, `edit-synthetics-global-variable`.
- Total tool count 166 → 175. `create-synthetics-browser-test` creates tests paused by default.

### Changed

- Package renamed to `@selerix/datadog-mcp`, published to the Selerix Azure Artifacts feed (`publishConfig.registry`). `server.json` manifest updated to match; a unit test keeps its versions in sync with `package.json`.
- `@us-all/mcp-toolkit` is vendored into `src/vendor/mcp-toolkit/` (MIT, license included) instead of being an npm dependency.
- Error redaction now removes the configured `DD_API_KEY` / `DD_APP_KEY` values and walks nested error fields.
- `update-synthetics-browser-test` and `edit-synthetics-global-variable` serialize their get-merge-save sequence per test / variable, and `set-synthetics-test-status` uses the same per-test lock so an edit cannot undo a pause.
- `update-synthetics-test` (API tests) takes the same per-test lock, so no tool that rewrites a test can undo a pause.
- HTTP transport: each request now gets its own transport and requests are handled one at a time. Before, the server answered the first request and then returned HTTP 500 to every later one. A client that disconnects while its request is waiting no longer blocks the queue, and a request that runs longer than 10 minutes is cut off (`requestTimeoutMs`).
- Error text returned as data (per-test errors of `set-synthetics-test-status`, aggregation `caveats`) is redacted like thrown errors.
- HTTP transport (`MCP_TRANSPORT=http`): fixed the localhost `Host` allowlist for IPv6 (`MCP_HTTP_HOST=::1`); requests addressed to `[::1]:port` were rejected with 403 even with a valid token. `dotenv` no longer prints its banner to stdout.
- CI token budget raised from 30000 to 35000 and made adjustable through the `TOKEN_BUDGET` repository variable; the token-stats script ignores a local `.env` `DD_TOOLS` / `DD_DISABLE`.
- Upstream's public npm and container publish workflows are disabled (`*.yml.disabled`).
- Security hardening after the architecture review: `DD_SITE` must be an official Datadog site (`datadoghq.com`, `us3`/`us5`/`ap1`/`ap2.datadoghq.com`, `datadoghq.eu`, `ddog-gov.com`) or the server refuses to start; redaction removes the value after `password=`, `token:` and similar, bearer values, JWTs and AWS key ids, and applies to every occurrence; HTTP mode only serves POST (405 otherwise, so an open GET stream cannot block the queue), compares the token in constant time, refuses `MCP_HTTP_SKIP_AUTH` unless bound to localhost, accepts `MCP_HTTP_ALLOWED_HOSTS` and no longer returns raw error text in a 500; `update-synthetics-browser-test` rejects `steps: []`.

### Notes

- Saving a browser test through `update-synthetics-browser-test` makes Datadog assign new public IDs to all steps and trim trailing whitespace from the test name (Datadog rejects the read-only step ID on update). `set-synthetics-test-status` does not have this effect.
- Writes stay off unless `DD_ALLOW_WRITE=true`.

## [1.20.0] - 2026-05-17

### Added

- **Workflow Automation tools (3)** — `get-workflow`, `list-workflow-instances`, `get-workflow-instance` under new `workflows` category. Surfaces step-level input/output/error from workflow runs (debugging `STEP_ERROR` cases such as Slack interactive message timeouts). Requires `workflows_read` scope on the application key. Total tool count 165 → 168.

## [1.11.0] - 2026-05-01

### Added

- **`analyze-monitor-state` aggregation tool** — monitor config + current state + recent triggered events + active downtimes in one call. Replaces 3 round-trips of `get-monitor` + `get-events` + `list-downtimes`.

## [1.10.0] - 2026-05-01

### Added

- **MCP Resources (`dd://` URI scheme)** — 4 resource templates: `dd://monitor/{id}`, `dd://dashboard/{id}`, `dd://slo/{id}`, `dd://incident/{id}`.

## [1.9.2] - 2026-05-01

### Added

- `pnpm token-stats` script + CI regression guard with `TOKEN_BUDGET=30000`.

## [1.9.1] - 2026-05-01

### Added

- **`extractFields` auto-apply** via `wrapToolHandler`. Schema field declared on `rum`, `security`, `incidents`, `monitors` core read tools.

## [1.9.0] - 2026-05-01

### Added

- **Token efficiency patterns** — addresses the 158-tool LLM context bloat (40-60K tokens of schema before any conversation).
  - `DD_TOOLS` / `DD_DISABLE` env vars: category-based tool toggles (16 categories: metrics, monitors, dashboards, logs, apm, rum, incidents, security, synthetics, ci, infra, fleet, status-pages, oncall, teams, account)
  - `search-tools` meta-tool (always enabled): natural-language tool discovery across all categories regardless of what's loaded
  - `extractFields` parameter: response field projection with comma-separated dotted paths + `*` wildcard. Applied to `get-dashboards`, `get-dashboard`, `search-logs`, `search-spans` (highest-token responses)
- New unit tests: `tests/unit/extract-fields.test.ts` (5 cases), `tests/unit/tool-registry.test.ts` (5 cases)

### Changed

- Total tools: 158 → 159 (+search-tools meta-tool)
- `src/index.ts` refactored: all `server.tool()` calls now route through `tool()` helper that registers in tool registry and conditionally loads based on category env vars

## [1.8.1] - 2026-05-01

### Security

- Pin transitive `hono >=4.12.14` via `pnpm.overrides` to address [GHSA-458j-xx4x-4375](https://github.com/advisories/GHSA-458j-xx4x-4375) (medium, hono/jsx attribute key HTML injection). Not exploitable via this MCP (stdio transport, no JSX SSR), but applied for hygiene.

## [1.8.0] - 2026-04-20

### Added

- **38 new tools** (120 → 158 total), Status Pages and Fleet Automation
- **Status Pages** (21 tools):
  - Pages: `list-status-pages`, `get-status-page`, `create-status-page`, `update-status-page`, `delete-status-page`, `publish-status-page`, `unpublish-status-page`
  - Components: `list-status-page-components`, `get-status-page-component`, `create-status-page-component`, `update-status-page-component`, `delete-status-page-component`
  - Degradations: `list-status-page-degradations`, `get-status-page-degradation`, `create-status-page-degradation`, `update-status-page-degradation`, `delete-status-page-degradation`
  - Maintenances: `list-status-page-maintenances`, `get-status-page-maintenance`, `create-status-page-maintenance`, `update-status-page-maintenance`
- **Fleet Automation** (17 tools):
  - Agents: `list-fleet-agents`, `get-fleet-agent-info`, `list-fleet-agent-versions`
  - Clusters: `list-fleet-clusters`
  - Tracers: `list-fleet-tracers`
  - Deployments: `list-fleet-deployments`, `get-fleet-deployment`, `create-fleet-deployment-configure`, `create-fleet-deployment-upgrade`, `cancel-fleet-deployment`
  - Schedules: `list-fleet-schedules`, `get-fleet-schedule`, `create-fleet-schedule`, `update-fleet-schedule`, `delete-fleet-schedule`, `trigger-fleet-schedule`
  - Pods: `list-fleet-instrumented-pods`
- New API clients: `StatusPagesApi`, `FleetAutomationApi` (v2)
- Fleet Automation unstable operations (17) enabled
- All write tools gated behind `DD_ALLOW_WRITE=true`

### Changed

- Upgraded `@datadog/datadog-api-client` from ^1.52.0 to ^1.56.0

## [1.7.0] - 2026-04-10

### Added

- **10 new tools** (110 → 120 total), SLO corrections and APM retention management
- **SLO Corrections**: `list-slo-corrections`, `get-slo-correction`, `create-slo-correction`, `update-slo-correction`, `delete-slo-correction` — exclude maintenance/deployment windows from SLO calculations
- **APM Retention Filters**: `list-apm-retention-filters`, `get-apm-retention-filter`, `create-apm-retention-filter`, `update-apm-retention-filter`, `delete-apm-retention-filter` — control which traces are retained for search
- New API clients: `ServiceLevelObjectiveCorrectionsApi` (v1), `APMRetentionFiltersApi` (v2)
- All write tools gated behind `DD_ALLOW_WRITE=true`

## [1.6.0] - 2026-04-10

### Added

- **10 new custom metrics tools** (100 → 110 total), log-based and span-based metrics CRUD
- **Logs Metrics**: `list-logs-metrics`, `get-logs-metric`, `create-logs-metric`, `update-logs-metric`, `delete-logs-metric` — generate custom metrics from log data
- **Spans Metrics**: `list-spans-metrics`, `get-spans-metric`, `create-spans-metric`, `update-spans-metric`, `delete-spans-metric` — generate custom metrics from APM span data
- New API clients: `LogsMetricsApi`, `SpansMetricsApi`
- All write tools gated behind `DD_ALLOW_WRITE=true`

## [1.5.0] - 2026-04-10

### Added

- **6 new Teams tools** (94 → 100 total), team management and membership
- `list-teams` — list teams with search, sort, and pagination
- `get-team` — get detailed information about a specific team
- `create-team` — create a new team with name, handle, and description
- `update-team` — update a team's name, handle, or description
- `delete-team` — delete a team
- `get-team-members` — get team members with roles and provisioning info
- New API client: `TeamsApi`
- All team write tools gated behind `DD_ALLOW_WRITE=true`

## [1.4.0] - 2026-04-10

### Added

- **8 new Security Monitoring tools** (86 → 94 total), extended security capabilities
- `get-security-signal` — get detailed information about a specific security signal
- `list-security-rules` — list security monitoring detection rules with search filtering
- `get-security-rule` — get detailed info about a specific detection rule
- `delete-security-rule` — delete a detection rule
- `list-security-suppressions` — list suppression rules
- `get-security-suppression` — get detailed info about a suppression rule
- `create-security-suppression` — create a suppression rule with query, expiration, data exclusion
- `delete-security-suppression` — delete a suppression rule
- All security write tools gated behind `DD_ALLOW_WRITE=true`

## [1.3.0] - 2026-04-10

### Added

- **5 new Incidents tools** (81 → 86 total), full incident lifecycle management
- `get-incident` — get detailed information about a specific incident by ID
- `search-incidents` — search incidents by query (state, severity, title keywords) with sort/pagination
- `create-incident` — create a new incident with title and customer impact info
- `update-incident` — update incident title, customer impact, timestamps
- `delete-incident` — delete an incident by ID
- Enabled unstable SDK operations: `v2.createIncident`, `v2.updateIncident`, `v2.deleteIncident`
- All incident write tools gated behind `DD_ALLOW_WRITE=true`

## [1.2.0] - 2026-04-10

### Added

- **15 new RUM tools** (66 → 81 total), comprehensive RUM API coverage
- **RUM Applications**: `list-rum-applications`, `get-rum-application`, `create-rum-application`, `update-rum-application`, `delete-rum-application` — RUM application CRUD
- **RUM Metrics**: `list-rum-metrics`, `get-rum-metric`, `create-rum-metric`, `update-rum-metric`, `delete-rum-metric` — RUM-based custom metrics CRUD
- **RUM Retention Filters**: `list-rum-retention-filters`, `get-rum-retention-filter`, `create-rum-retention-filter`, `update-rum-retention-filter`, `delete-rum-retention-filter` — RUM data retention filter management
- New API clients: `RumMetricsApi`, `RumRetentionFiltersApi`
- All new write tools gated behind `DD_ALLOW_WRITE=true`

## [1.1.1] - 2026-03-24

### Fixed

- All `z.number()` schemas changed to `z.coerce.number()` to handle MCP clients sending number parameters as strings. Fixes `list-active-metrics`, `get-dashboards`, `search-security-signals`, `search-ci-tests` and other tools failing with "expected number, received string" validation errors.

## [1.1.0] - 2026-03-24

### Added

- **20 new tools** (46 → 66 total), closing feature gaps with the official Datadog MCP server
- **Services**: `list-services`, `get-service-definition` — Software Catalog (SoftwareCatalogApi)
- **Containers**: `list-containers` — infrastructure container monitoring (ContainersApi)
- **Processes**: `list-processes` — process monitoring (ProcessesApi)
- **Audit Logs**: `search-audit-logs` — organization activity tracking (AuditApi)
- **Cases**: `list-cases`, `get-case`, `create-case`, `update-case-status` — Case Management (CaseManagementApi)
- **Error Tracking**: `list-error-tracking-issues`, `get-error-tracking-issue` — error tracking issues (ErrorTrackingApi)
- **CI/CD Visibility**: `search-ci-pipelines`, `aggregate-ci-pipelines`, `search-ci-tests`, `aggregate-ci-tests` — CI pipeline and test visibility (CIVisibilityPipelinesApi, CIVisibilityTestsApi)
- **Network Devices**: `list-network-devices`, `get-network-device` — network device monitoring (NetworkDeviceMonitoringApi)
- **DORA Metrics**: `send-dora-deployment`, `send-dora-incident` — DevOps performance metrics (DORAMetricsApi)
- **Monitor Validation**: `validate-monitor` — validate monitor definitions without creating them
- **Test infrastructure**: vitest with 18 tests across 4 test files (config, utils, schemas, tool registration)
- **Test Visibility**: dd-trace integration for Datadog CI Test Visibility in GitHub Actions
- CI workflow now runs tests on Node 20+ with dd-trace reporting

### Fixed

- Cases API `pageNumber` changed from 0-based to 1-based (Datadog API requires `> 0`)
- Error Tracking `searchIssues` uses SDK model class instances (ObjectSerializer compatibility)
- CI aggregate tools (`aggregate-ci-pipelines`, `aggregate-ci-tests`) use SDK model class instances for `groupBy` serialization

## [1.0.0] - 2026-02-27

### Added

- **46 Datadog tools** across 10 categories
- **Metrics**: `query-metrics`, `get-metrics`, `get-metric-metadata`, `list-active-metrics`, `list-metric-tags`
- **Monitors**: `get-monitors`, `get-monitor`, `create-monitor`, `update-monitor`, `delete-monitor`, `mute-monitor`
- **Dashboards**: `get-dashboards`, `get-dashboard`, `create-dashboard`, `update-dashboard`, `delete-dashboard`
- **Logs**: `search-logs`, `aggregate-logs`, `send-logs`
- **Events**: `get-events`, `post-event`
- **Incidents**: `get-incidents`
- **APM**: `search-spans`
- **RUM**: `search-rum-events`, `aggregate-rum`
- **Hosts**: `list-hosts`, `get-host-totals`
- **SLOs**: `list-slos`, `get-slo`, `get-slo-history`
- **Synthetics**: `list-synthetics`, `get-synthetics-result`, `trigger-synthetics`, `create-synthetics-test`, `update-synthetics-test`, `delete-synthetics-test`
- **Downtimes**: `list-downtimes`, `create-downtime`, `cancel-downtime`
- **Security**: `search-security-signals`
- **Account**: `get-usage-summary`, `list-users`
- **Notebooks**: `list-notebooks`, `get-notebook`
- **On-Call**: `get-team-oncall`, `get-oncall-schedule`
- **Read-only mode** by default — 15 write tools gated behind `DD_ALLOW_WRITE=true`
- Structured error handling with `wrapToolHandler` for all 46 tools
- Error sanitization — API keys, app keys, and auth headers redacted from error output
- Datadog API error extraction — HTTP status codes, error bodies, and request IDs surfaced
- Improved type-safe error parsing with TypeScript type guards; minimized unsafe casts where unavoidable
- Rich tool descriptions with usage examples for all zod schema fields
- Smoke test script (`pnpm run smoke`) validating 5 core read-only tools
- DD_SITE documentation for all 5 Datadog regions (US1, US3, US5, EU1, AP1)
- SECURITY.md with read-only mode docs and API key best practices
- Docker support (multi-stage build)
- GitHub Actions CI/CD (build, npm publish, Docker publish)
- English and Korean documentation
