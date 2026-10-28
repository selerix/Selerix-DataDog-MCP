import { describe, it, expect, vi, beforeEach } from "vitest";

const cfg = vi.hoisted(() => ({
  browserStepTypes: null as string[] | null,
  browserUrlHosts: null as string[] | null,
  allowPrivateLocations: false,
}));
vi.mock("../../src/config.js", () => ({ config: cfg, validateConfig: () => {} }));

import { checkBrowserWrite, BrowserLimitError, DEFAULT_BLOCKED_STEP_TYPES } from "../../src/tools/browser-limits.js";

const step = (type: string, params?: Record<string, unknown>, name = "s") => ({ type, name, params });
const steps = (...s: Record<string, any>[]) => s.map((x, index) => ({ step: x, index }));

beforeEach(() => {
  cfg.browserStepTypes = null;
  cfg.browserUrlHosts = null;
  cfg.allowPrivateLocations = false;
});

describe("step types", () => {
  it("refuses the JavaScript and API-call steps by default, naming the step", () => {
    for (const type of DEFAULT_BLOCKED_STEP_TYPES) {
      expect(() => checkBrowserWrite({ steps: steps(step("wait"), step(type, {}, "Do thing")) }), type).toThrow(/step 2 \("Do thing"\).*refused by default/);
    }
  });

  it("is case-insensitive for the type name and lets ordinary steps through", () => {
    expect(() => checkBrowserWrite({ steps: steps(step("ASSERTFROMJAVASCRIPT")) })).toThrow(BrowserLimitError);
    expect(() => checkBrowserWrite({ steps: steps(step("click"), step("typeText"), step("wait", { value: 5 }), step("somethingNew")) })).not.toThrow();
  });

  it("DD_BROWSER_STEP_TYPES replaces the default with an explicit list", () => {
    cfg.browserStepTypes = ["gotourl", "wait"];
    expect(() => checkBrowserWrite({ steps: steps(step("goToUrl", { value: "https://a.test" }), step("wait")) })).not.toThrow();
    expect(() => checkBrowserWrite({ steps: steps(step("click")) })).toThrow(/not in DD_BROWSER_STEP_TYPES/);
    expect(() => checkBrowserWrite({ steps: steps(step("assertFromJavascript")) })).toThrow(/not in DD_BROWSER_STEP_TYPES/);
  });

  it("'all' allows every step type", () => {
    cfg.browserStepTypes = ["all"];
    expect(() => checkBrowserWrite({ steps: steps(step("assertFromJavascript"), step("runApiTest")) })).not.toThrow();
  });
});

describe("URLs", () => {
  it("always refuses non-http(s) schemes, in the start URL and in goToUrl steps", () => {
    expect(() => checkBrowserWrite({ startUrl: "file:///etc/passwd" })).toThrow(/scheme "file:"/);
    expect(() => checkBrowserWrite({ startUrl: "javascript:alert(1)" })).toThrow(/only http and https/);
    expect(() => checkBrowserWrite({ steps: steps(step("goToUrl", { value: "ftp://x.test/a" })) })).toThrow(/only http and https/);
  });

  it("allows any http(s) host and variable URLs when no host list is set", () => {
    expect(() => checkBrowserWrite({ startUrl: "https://anything.example.org/x", steps: steps(step("goToUrl", { value: "{{ BASE_URL }}/home" })) })).not.toThrow();
  });

  it("with DD_BROWSER_URL_HOSTS, allows the host and its subdomains only", () => {
    cfg.browserUrlHosts = ["selerix.com", "localhost"];
    expect(() => checkBrowserWrite({ startUrl: "https://selerix.com/a", steps: steps(step("goToUrl", { value: "https://stage.app.selerix.com/b" })) })).not.toThrow();
    expect(() => checkBrowserWrite({ startUrl: "http://localhost:3000/" })).not.toThrow();
    for (const bad of ["https://evil.test/", "https://notselerix.com/", "https://selerix.com.evil.test/", "http://169.254.169.254/latest"]) {
      expect(() => checkBrowserWrite({ startUrl: bad }), bad).toThrow(/not in DD_BROWSER_URL_HOSTS/);
    }
    expect(() => checkBrowserWrite({ steps: steps(step("goToUrl", { value: "https://evil.test/" }, "Open")) })).toThrow(/step 1 \("Open"\) URL points at "evil.test"/);
  });

  it("with a host list, refuses a URL it cannot check (a variable) rather than guessing", () => {
    cfg.browserUrlHosts = ["selerix.com"];
    expect(() => checkBrowserWrite({ startUrl: "{{ BASE_URL }}" })).toThrow(/use a literal URL/);
  });

  it("does not look at the URLs of other step types", () => {
    cfg.browserUrlHosts = ["selerix.com"];
    expect(() => checkBrowserWrite({ steps: steps(step("typeText", { value: "https://evil.test/" })) })).not.toThrow();
  });
});

describe("private locations", () => {
  it("are refused unless DD_ALLOW_PRIVATE_LOCATIONS=true", () => {
    expect(() => checkBrowserWrite({ locations: ["aws:us-east-2", "pl:my-private-location"] })).toThrow(/private location/);
    expect(() => checkBrowserWrite({ locations: ["aws:us-east-2"] })).not.toThrow();
    cfg.allowPrivateLocations = true;
    expect(() => checkBrowserWrite({ locations: ["pl:my-private-location"] })).not.toThrow();
  });
});
