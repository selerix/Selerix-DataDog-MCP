const fs = require("fs");
function rw(f, fn) { const s = fs.readFileSync(f, "utf8"); const o = fn(s); if (o === s) throw new Error("no change " + f); fs.writeFileSync(f, o); }
function sub(s, a, b) { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 60)); return s.replace(a, b); }
rw("src/vendor/mcp-toolkit/wrap-tool-handler.ts", (s) =>
  sub(s, "/\/\/[^\s/:@]+:[^\s/@]+@/, // user:password@ in a URL", "/\/\/[^\s/:@]*:[^\s/@]+@/, // user:password@ or :password@ (empty user) in a URL"));
rw("tests/unit/utils.test.ts", (s) =>
  sub(s, '"request to https://svc:Hunter2!x@host.test/path failed",', '"request to https://svc:Hunter2!x@host.test/path failed",\n      "cache redis://:Hunter2!x@cache.test:6379/0 unreachable",'));
