// Ad-hoc behavior test for index.mjs (run: node test-auto.mjs)
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert";

const fakeLocal = mkdtempSync(join(tmpdir(), "gs-mcp-test-"));
process.env.LOCALAPPDATA = fakeLocal;
delete process.env.GHOSTSCREEN_MCP_EXE;

const logs = { info: [], error: [] };
const mounts = [];
const ctx = {
  logger: { info: (...a) => logs.info.push(a.join(" ")), error: (...a) => logs.error.push(a.join(" ")) },
  plugin: (_client, opts) => mounts.push(opts),
};

const { apply } = await import("./index.mjs");

// Case 1: no exe anywhere, autoDownload disabled -> guidance only, no mount
await apply(ctx, { autoDownload: false });
assert.strictEqual(mounts.length, 0, "no mount when exe missing and autoDownload off");
assert.ok(logs.error.some((l) => l.includes("GhostScreen.Mcp.exe not found")), "guidance logged");
console.log("case1 ok: guidance-only when autoDownload disabled");

// Case 2: versioned auto-download layout on disk -> found, mounted
mkdirSync(join(fakeLocal, "GhostScreen", "app", "GhostScreen-0.1.0", "mcp"), { recursive: true });
writeFileSync(join(fakeLocal, "GhostScreen", "app", "GhostScreen-0.1.0", "mcp", "GhostScreen.Mcp.exe"), "stub");
await apply(ctx, {});
assert.strictEqual(mounts.length, 1, "mounted from versioned app dir");
assert.strictEqual(mounts[0].command, join(fakeLocal, "GhostScreen", "app", "GhostScreen-0.1.0", "mcp", "GhostScreen.Mcp.exe"));
assert.strictEqual(mounts[0].failOnStartupError, false);
console.log("case2 ok: versioned layout mounted at", mounts[0].command);

// Case 3: config exePath wins over everything
writeFileSync(join(fakeLocal, "custom.exe"), "stub");
await apply(ctx, { exePath: join(fakeLocal, "custom.exe") });
assert.strictEqual(mounts[1].command, join(fakeLocal, "custom.exe"));
console.log("case3 ok: config exePath takes priority");

// Case 4 (network, ~200MB): real auto-download path — skipped unless RUN_DOWNLOAD=1
if (process.env.RUN_DOWNLOAD === "1") {
  rmSync(join(fakeLocal, "GhostScreen"), { recursive: true, force: true });
  await apply(ctx, {});
  if (!mounts[2]) {
    console.error("--- logs ---\n" + logs.info.concat(logs.error).join("\n"));
    assert.fail("mounted after auto-download");
  }
  console.log("case4 ok: auto-download mounted at", mounts[2].command);
}

console.log("ALL OK");
