// Set env vars before any module loads (config.ts reads at import time)
process.env.DD_API_KEY = "test-api-key";
process.env.DD_APP_KEY = "test-app-key";
process.env.DD_SITE = "us5.datadoghq.com";
// Pin the behaviour switches too: config.ts loads a local .env, and dotenv never overrides variables
// that are already set, so a developer's DD_ALLOW_WRITE / DD_TOOLS / DD_DISABLE cannot change test results.
process.env.DD_ALLOW_WRITE = "false";
process.env.DD_TOOLS = "";
process.env.DD_DISABLE = "";
process.env.DD_WRITE_TOOLS = "";
process.env.DD_AUDIT_LOG = "off"; // keeps test output free of audit lines; audit tests inject their own sink
