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
process.env.DD_BROWSER_STEP_TYPES = "";
process.env.DD_BROWSER_URL_HOSTS = "";
process.env.DD_ALLOW_PRIVATE_LOCATIONS = "";
// Importing src/index.ts starts the server. Pin stdio and clear the HTTP settings, or a developer who has
// MCP_TRANSPORT=http (or a port) in their shell would make the registration tests bind real ports, collide,
// and terminate the run. Tests that need HTTP pass their own options to startMcpServer.
process.env.MCP_TRANSPORT = "stdio";
for (const name of ["MCP_HTTP_PORT", "MCP_HTTP_HOST", "MCP_HTTP_TOKEN", "MCP_HTTP_SKIP_AUTH", "MCP_HTTP_ALLOW_REMOTE", "MCP_HTTP_ALLOWED_HOSTS"]) {
  delete process.env[name];
}
