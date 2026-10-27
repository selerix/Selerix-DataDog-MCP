import { z } from "zod/v4";
import { syntheticsApi } from "../client.js";
import { assertWriteAllowed } from "./utils.js";

// --- Browser tests ---

export const getSyntheticsBrowserTestSchema = z.object({
  publicId: z.string().describe("Browser test public ID. Example: abc-def-ghi"),
  includeSteps: z.boolean().optional().default(true).describe("Include the recorded steps (with params). Set false for a compact overview"),
});

export async function getSyntheticsBrowserTest(params: z.infer<typeof getSyntheticsBrowserTestSchema>) {
  const t = await syntheticsApi.getBrowserTest({ publicId: params.publicId });
  const steps = t.steps ?? [];
  return {
    publicId: t.publicId,
    name: t.name,
    status: t.status,
    message: t.message,
    tags: t.tags,
    locations: t.locations,
    monitorId: t.monitorId,
    startUrl: t.config?.request?.url,
    configVariables: t.config?.configVariables,
    variables: t.config?.variables,
    options: t.options,
    stepCount: steps.length,
    steps: params.includeSteps
      ? steps.map((s, index) => ({
          index,
          publicId: s.publicId,
          name: s.name,
          type: s.type,
          params: s.params,
          allowFailure: s.allowFailure,
          isCritical: s.isCritical,
          alwaysExecute: s.alwaysExecute,
          exitIfSucceed: s.exitIfSucceed,
          noScreenshot: s.noScreenshot,
          timeout: s.timeout,
        }))
      : undefined,
  };
}

export const getSyntheticsBrowserResultsSchema = z.object({
  publicId: z.string().describe("Browser test public ID. Example: abc-def-ghi"),
  fromTs: z.coerce.number().optional().describe("Start time in milliseconds. Example: 1740000000000"),
  toTs: z.coerce.number().optional().describe("End time in milliseconds. Example: 1740003600000"),
  probeDc: z.array(z.string()).optional().describe("Filter by probe locations. Example: [\"aws:us-east-1\"]"),
});

export async function getSyntheticsBrowserResults(params: z.infer<typeof getSyntheticsBrowserResultsSchema>) {
  const response = await syntheticsApi.getBrowserTestLatestResults({
    publicId: params.publicId,
    fromTs: params.fromTs,
    toTs: params.toTs,
    probeDc: params.probeDc,
  });

  const results = response.results ?? [];
  return {
    count: results.length,
    results: results.map((r) => ({
      resultId: r.resultId,
      status: r.status,
      checkTime: r.checkTime,
      probeDc: r.probeDc,
      durationMs: r.result?.duration,
      errorCount: r.result?.errorCount,
      stepCountCompleted: r.result?.stepCountCompleted,
      stepCountTotal: r.result?.stepCountTotal,
    })),
    lastTimestamp: response.lastTimestampFetched,
  };
}

export const getSyntheticsBrowserResultSchema = z.object({
  publicId: z.string().describe("Browser test public ID. Example: abc-def-ghi"),
  resultId: z.string().describe("Result ID from get-synthetics-browser-results. Example: 1234567890123456789"),
  onlyProblemSteps: z.boolean().optional().default(false).describe("Return only failed, skipped or warning steps"),
});

export async function getSyntheticsBrowserResult(params: z.infer<typeof getSyntheticsBrowserResultSchema>) {
  const r = await syntheticsApi.getBrowserTestResult({
    publicId: params.publicId,
    resultId: params.resultId,
  });

  const details = r.result?.stepDetails ?? [];
  const mapped = details.map((d, index) => ({
    index,
    stepId: d.stepId,
    description: d.description,
    type: d.type,
    durationMs: d.duration,
    url: d.url,
    skipped: d.skipped,
    allowFailure: d.allowFailure,
    failure: d.failure,
    error: d.error,
    browserErrors: d.browserErrors,
    warnings: d.warnings,
  }));
  const hasProblem = (s: (typeof mapped)[number]) =>
    Boolean(s.failure || s.error || s.skipped || (s.warnings?.length ?? 0) > 0);

  return {
    resultId: r.resultId,
    status: r.status,
    checkTime: r.checkTime,
    probeDc: r.probeDc,
    passed: r.result?.passed,
    // The SDK doc says seconds, but the API returns milliseconds here (verified live: 17936 matches the
    // 17936 ms in get-synthetics-browser-results for the same run). Do not multiply by 1000.
    durationMs: r.result?.duration,
    startUrl: r.result?.startUrl,
    browserType: r.result?.browserType,
    browserVersion: r.result?.browserVersion,
    device: r.result?.device,
    failure: r.result?.failure,
    error: r.result?.error,
    stepCount: mapped.length,
    steps: params.onlyProblemSteps ? mapped.filter(hasProblem) : mapped,
  };
}

const stepUpdateSchema = z.object({
  index: z.coerce.number().optional().describe("0-based position of the step to change (as shown by get-synthetics-browser-test)"),
  publicId: z.string().optional().describe("Step public ID, as an alternative to index"),
  name: z.string().optional().describe("New step name"),
  params: z.record(z.string(), z.any()).optional().describe("Step params to shallow-merge over the existing params. Example: {\"value\":\"{{ USERNAME }}\"}"),
  allowFailure: z.boolean().optional().describe("Allow this step to fail"),
  isCritical: z.boolean().optional().describe("Mark the step as critical"),
  alwaysExecute: z.boolean().optional().describe("Always execute this step"),
  exitIfSucceed: z.boolean().optional().describe("Stop the test if this step succeeds"),
  noScreenshot: z.boolean().optional().describe("Skip the screenshot for this step"),
  timeout: z.coerce.number().optional().describe("Step timeout in seconds"),
});

export const updateSyntheticsBrowserTestSchema = z.object({
  publicId: z.string().describe("Browser test public ID to update. Example: abc-def-ghi"),
  name: z.string().min(1).optional().describe("New test name"),
  message: z.string().optional().describe("New notification message"),
  tags: z.array(z.string()).optional().describe("New tags (replaces the existing list)"),
  status: z.enum(["live", "paused"]).optional().describe("New test status"),
  locations: z.array(z.string()).optional().describe("New test locations (replaces the existing list)"),
  startUrl: z.string().min(1).optional().describe("New start URL"),
  stepUpdates: z.array(stepUpdateSchema).optional().describe("Targeted edits to individual steps. Cannot be combined with steps"),
  steps: z.array(z.record(z.string(), z.any())).optional().describe("Full replacement list of steps. Cannot be combined with stepUpdates"),
  configVariables: z.array(z.record(z.string(), z.any())).optional().describe("Full replacement of config variables, e.g. references to global variables. Example: [{\"name\":\"USERNAME\",\"type\":\"global\",\"id\":\"<global-variable-id>\"}]"),
  variables: z.array(z.record(z.string(), z.any())).optional().describe("Full replacement of the test's local (extracted) variables"),
  dryRun: z.boolean().optional().default(false).describe("Preview the resulting changes without saving; does not require DD_ALLOW_WRITE"),
});

export function applyStepUpdates(
  steps: Record<string, any>[],
  updates: z.infer<typeof stepUpdateSchema>[],
): { steps: Record<string, any>[]; changed: number[] } {
  const next = steps.map((s) => ({ ...s }));
  const changed = new Set<number>();

  for (const u of updates) {
    if (u.index === undefined && !u.publicId) {
      throw new Error("Each stepUpdate needs an index or a publicId");
    }
    const i = u.index !== undefined ? u.index : next.findIndex((s) => s.publicId === u.publicId);
    if (!Number.isInteger(i) || i < 0 || i >= next.length) {
      const which = u.index !== undefined ? `index ${u.index}` : `publicId ${u.publicId}`;
      throw new Error(`Step not found: ${which} (test has ${next.length} steps)`);
    }

    const step = next[i];
    if (u.name !== undefined) step.name = u.name;
    if (u.params !== undefined) step.params = { ...(step.params ?? {}), ...u.params };
    if (u.allowFailure !== undefined) step.allowFailure = u.allowFailure;
    if (u.isCritical !== undefined) step.isCritical = u.isCritical;
    if (u.alwaysExecute !== undefined) step.alwaysExecute = u.alwaysExecute;
    if (u.exitIfSucceed !== undefined) step.exitIfSucceed = u.exitIfSucceed;
    if (u.noScreenshot !== undefined) step.noScreenshot = u.noScreenshot;
    if (u.timeout !== undefined) step.timeout = u.timeout;
    changed.add(i);
  }

  return { steps: next, changed: [...changed].sort((a, b) => a - b) };
}

export async function updateSyntheticsBrowserTest(params: z.infer<typeof updateSyntheticsBrowserTestSchema>) {
  if (params.steps && params.stepUpdates) {
    throw new Error("Pass either steps (full replacement) or stepUpdates (targeted edits), not both");
  }
  if (!params.dryRun) assertWriteAllowed();

  const current = await syntheticsApi.getBrowserTest({ publicId: params.publicId });

  const currentSteps = (current.steps ?? []) as Record<string, any>[];
  let steps = currentSteps;
  let changedSteps: number[] = [];
  if (params.stepUpdates) {
    ({ steps, changed: changedSteps } = applyStepUpdates(currentSteps, params.stepUpdates));
  } else if (params.steps) {
    steps = params.steps;
  }

  // PUT replaces the recording. If Datadog returned no steps for this test (seen for a few tests whose
  // results still report steps), saving would send an empty list back and could wipe the recording.
  const stepsUnreadable = currentSteps.length === 0 && !params.steps;

  const summary = {
    warning: stepsUnreadable
      ? "Datadog returned no steps for this test; saving is refused unless you pass `steps` explicitly"
      : undefined,
    publicId: params.publicId,
    name: params.name ?? current.name,
    status: params.status ?? current.status,
    startUrl: params.startUrl ?? current.config?.request?.url,
    stepCountBefore: currentSteps.length,
    stepCountAfter: steps.length,
    changedStepIndexes: params.steps ? "all (full replacement)" : changedSteps,
    configVariablesReplaced: params.configVariables !== undefined,
    variablesReplaced: params.variables !== undefined,
  };

  if (params.dryRun) {
    return { dryRun: true, saved: false, ...summary };
  }
  if (stepsUnreadable) {
    throw new Error(
      `${summary.warning}. Use get-synthetics-browser-test to inspect the test and edit it in the Datadog UI if its steps are not exposed by the API.`,
    );
  }

  // PUT replaces the whole definition, so send the current test with the edits merged in.
  const response = await syntheticsApi.updateBrowserTest({
    publicId: params.publicId,
    body: {
      name: params.name ?? current.name,
      type: current.type,
      message: params.message ?? current.message ?? "",
      tags: params.tags ?? current.tags,
      status: params.status ?? current.status,
      locations: params.locations ?? current.locations,
      options: current.options,
      config: {
        ...current.config,
        request: {
          ...current.config?.request,
          ...(params.startUrl ? { url: params.startUrl } : {}),
        },
        ...(params.configVariables ? { configVariables: params.configVariables as any } : {}),
        ...(params.variables ? { variables: params.variables as any } : {}),
      },
      steps: steps as any,
    },
  });

  return {
    dryRun: false,
    saved: true,
    ...summary,
    stepCountSaved: response.steps?.length ?? 0,
  };
}

// --- Global variables ---

export const listSyntheticsGlobalVariablesSchema = z.object({});

export async function listSyntheticsGlobalVariables(_params: z.infer<typeof listSyntheticsGlobalVariablesSchema>) {
  const response = await syntheticsApi.listGlobalVariables();
  const variables = response.variables ?? [];
  return {
    count: variables.length,
    variables: variables.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      tags: v.tags,
      secure: v.value?.secure,
      isTotp: v.isTotp,
      isFido: v.isFido,
      parseTestPublicId: v.parseTestPublicId,
    })),
  };
}

export const getSyntheticsGlobalVariableSchema = z.object({
  variableId: z.string().describe("Global variable ID (from list-synthetics-global-variables)"),
});

export async function getSyntheticsGlobalVariable(params: z.infer<typeof getSyntheticsGlobalVariableSchema>) {
  const v = await syntheticsApi.getGlobalVariable({ variableId: params.variableId });
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    tags: v.tags,
    secure: v.value?.secure,
    // Secure values are never exposed; only plain ones are returned.
    value: v.value?.secure ? undefined : v.value?.value,
    isTotp: v.isTotp,
    isFido: v.isFido,
    parseTestPublicId: v.parseTestPublicId,
  };
}

export const editSyntheticsGlobalVariableSchema = z.object({
  variableId: z.string().describe("Global variable ID to edit (from list-synthetics-global-variables)"),
  name: z.string().optional().describe("New variable name (uppercase letters, digits and underscores)"),
  description: z.string().optional().describe("New description"),
  tags: z.array(z.string()).optional().describe("New tags (replaces the existing list)"),
  value: z.string().optional().describe("New value. Required when editing a secure variable, because its current value cannot be read back"),
});

export async function editSyntheticsGlobalVariable(params: z.infer<typeof editSyntheticsGlobalVariableSchema>) {
  assertWriteAllowed();
  const current = await syntheticsApi.getGlobalVariable({ variableId: params.variableId });

  if (current.value?.secure && params.value === undefined && !current.parseTestPublicId) {
    throw new Error(
      "This global variable is secure, so its current value cannot be read and re-sent. Provide `value` to edit it.",
    );
  }

  const response = await syntheticsApi.editGlobalVariable({
    variableId: params.variableId,
    body: {
      name: params.name ?? current.name,
      description: params.description ?? current.description,
      tags: params.tags ?? current.tags,
      attributes: current.attributes,
      isFido: current.isFido,
      isTotp: current.isTotp,
      parseTestOptions: current.parseTestOptions,
      parseTestPublicId: current.parseTestPublicId,
      value: {
        ...current.value,
        ...(params.value !== undefined ? { value: params.value } : {}),
      },
    },
  });

  return {
    id: response.id,
    name: response.name,
    description: response.description,
    tags: response.tags,
    secure: response.value?.secure,
    valueUpdated: params.value !== undefined,
  };
}
