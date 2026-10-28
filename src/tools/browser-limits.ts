import { config } from "../config.js";

/**
 * Limits on what the browser-test write tools may put into a test (security review SEC-8). A model can
 * build any step object and any start URL, and a test runs from Datadog's locations, or from a private
 * location inside the Selerix network, so what a test may do is restricted here, before anything is sent.
 *
 *  - Step types: JavaScript-running and API-calling steps are refused unless allowed. `DD_BROWSER_STEP_TYPES`
 *    replaces the default with an explicit list (or `all`).
 *  - URLs: `http`/`https` only (always). With `DD_BROWSER_URL_HOSTS` set, start URLs and goToUrl steps must
 *    stay on those hosts (a host also allows its subdomains).
 *  - Private locations (`pl:` ids) need `DD_ALLOW_PRIVATE_LOCATIONS=true`.
 *
 * Only what a call writes is checked (new or replacement steps, steps changed by `stepUpdates`, a new start
 * URL, new locations); steps that already exist in a test are left alone.
 */

/** Steps that run JavaScript in the page or call another service, refused unless allowed. */
export const DEFAULT_BLOCKED_STEP_TYPES = ["assertFromJavascript", "extractFromJavascript", "runApiTest"];

const URL_STEP_TYPES = new Set(["gotourl", "gotourlandmeasuretti"]);

export class BrowserLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserLimitError";
  }
}

export interface BrowserWriteInput {
  startUrl?: string;
  /** The steps this call writes, with their position in the test. */
  steps?: { step: Record<string, any>; index: number }[];
  locations?: string[];
}

function describeStep(index: number, step: Record<string, any>): string {
  return `step ${index + 1}${typeof step.name === "string" && step.name ? ` ("${step.name}")` : ""}`;
}

function hostAllowed(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** Throws BrowserLimitError when `raw` is not an allowed URL; `what` names it in the message. */
function checkUrl(raw: unknown, what: string, allowedHosts: string[] | null): void {
  if (typeof raw !== "string" || raw.length === 0) return; // nothing to check (a step with no URL)
  // With a host list, a {{ variable }} anywhere in the URL is refused: its value is substituted when the test
  // runs and can change the destination after this check, for example https://{{ T }}@selerix.com/ with
  // T = "evil.test/#". The URL that is saved is the template, so only a literal URL can be verified.
  if (allowedHosts && raw.includes("{{")) {
    throw new BrowserLimitError(
      `${what} contains a variable reference ({{ }}), whose value could change the destination, so it cannot be checked against DD_BROWSER_URL_HOSTS; use a literal URL`,
    );
  }
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    // Not an absolute URL, typically a variable such as {{ BASE_URL }}.
  }
  if (url && url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrowserLimitError(`${what} uses the scheme "${url.protocol}"; only http and https are allowed`);
  }
  if (!allowedHosts) return;
  if (!url) {
    throw new BrowserLimitError(
      `${what} is not a literal http(s) URL, so its host cannot be checked against DD_BROWSER_URL_HOSTS; use a literal URL`,
    );
  }
  if (!hostAllowed(url.hostname, allowedHosts)) {
    throw new BrowserLimitError(`${what} points at "${url.hostname}", which is not in DD_BROWSER_URL_HOSTS (${allowedHosts.join(", ")})`);
  }
}

export function checkBrowserWrite(input: BrowserWriteInput): void {
  // Read at call time. Absent values (a test double for the config) mean the defaults.
  const stepTypes = config.browserStepTypes ?? null;
  const urlHosts = config.browserUrlHosts ?? null;
  const privateOk = config.allowPrivateLocations === true;

  const allowAllTypes = stepTypes?.includes("all") ?? false;
  const blocked = new Set(DEFAULT_BLOCKED_STEP_TYPES.map((t) => t.toLowerCase()));

  for (const { step, index } of input.steps ?? []) {
    const type = typeof step.type === "string" ? step.type : "";
    const key = type.toLowerCase();
    if (!allowAllTypes) {
      if (stepTypes) {
        if (!stepTypes.includes(key)) {
          throw new BrowserLimitError(
            `${describeStep(index, step)} has type "${type}", which is not in DD_BROWSER_STEP_TYPES (${stepTypes.join(", ")})`,
          );
        }
      } else if (blocked.has(key)) {
        throw new BrowserLimitError(
          `${describeStep(index, step)} has type "${type}", which runs JavaScript or calls another service and is refused by default. ` +
            `Set DD_BROWSER_STEP_TYPES (a list of allowed types, or "all") to allow it`,
        );
      }
    }
    if (URL_STEP_TYPES.has(key)) {
      checkUrl((step.params as Record<string, unknown> | undefined)?.value, `${describeStep(index, step)} URL`, urlHosts);
    }
  }

  if (input.startUrl !== undefined) checkUrl(input.startUrl, "The start URL", urlHosts);

  if (!privateOk) {
    const privateLocation = (input.locations ?? []).find((l) => l.toLowerCase().startsWith("pl:"));
    if (privateLocation) {
      throw new BrowserLimitError(
        `Location "${privateLocation}" is a private location, which runs inside a private network; set DD_ALLOW_PRIVATE_LOCATIONS=true to allow it`,
      );
    }
  }
}
