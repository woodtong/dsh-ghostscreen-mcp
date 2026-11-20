// Ad-hoc behavior test for index.mjs (run: node test-auto.mjs; RUN_DOWNLOAD=1 for live download)
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert";

const fakeLocal = mkdtempSync(join(tmpdir(), "gs-mcp-test-"));
process.env.LOCALAPPDATA = fakeLocal;
delete process.env.GHOSTSCREEN_MCP_EXE;

const logs = { info: [], error: [] };
const mounts = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = {
  logger: { info: (...a) => logs.info.push(a.join(" ")), error: (...a) => logs.error.push(a.join(" ")) },
  plugin: (_client, opts) => mounts.push(opts),
};

const { apply } = await import("./index.mjs");
const app = join(fakeLocal, "GhostScreen", "app");

// Case 1: nothing installed, autoDownload disabled -> guidance only, no mount
await apply(ctx, { autoDownload: false, autoUpdate: false });
assert.strictEqual(mounts.length, 0, "no mount when exe missing and autoDownload off");
assert.ok(logs.error.some((l) => l.includes("GhostScreen.Mcp.exe not found")), "guidance logged");
console.log("case1 ok: guidance-only when autoDownload disabled");

// Case 2: two versions under versions\ -> newest wins
for (const [v, mkVer] of [["0.1.0", true], ["0.3.0", true], ["0.2.9", true]]) {
  mkdirSync(join(app, "versions", v, "mcp"), { recursive: true });
  writeFileSync(join(app, "versions", v, "mcp", "GhostScreen.Mcp.exe"), "stub");
  if (mkVer) writeFileSync(join(app, "versions", v, "VERSION"), v);
}
await apply(ctx, { autoUpdate: false });
assert.strictEqual(mounts.length, 1, "mounted from versions dir");
assert.ok(mounts[0].command.includes(join("versions", "0.3.0")), "newest version picked: " + mounts[0].command);
console.log("case2 ok: newest of {0.1.0,0.2.9,0.3.0} mounted");

// Case 3: config exePath pins and suppresses update check
writeFileSync(join(fakeLocal, "custom.exe"), "stub");
await apply(ctx, { exePath: join(fakeLocal, "custom.exe") });
assert.strictEqual(mounts[1].command, join(fakeLocal, "custom.exe"));
console.log("case3 ok: config exePath takes priority");

// Case 4: legacy install.ps1 layout (app\mcp\ + app\VERSION) is found when no versions\
const fake2 = mkdtempSync(join(tmpdir(), "gs-mcp-test-"));
const saved = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = fake2;
mkdirSync(join(fake2, "GhostScreen", "app", "mcp"), { recursive: true });
writeFileSync(join(fake2, "GhostScreen", "app", "mcp", "GhostScreen.Mcp.exe"), "stub");
writeFileSync(join(fake2, "GhostScreen", "app", "VERSION"), "0.9.9");
await apply(ctx, { autoUpdate: false });
assert.strictEqual(mounts[2].command, join(fake2, "GhostScreen", "app", "mcp", "GhostScreen.Mcp.exe"));
console.log("case4 ok: legacy app\\mcp layout found");
process.env.LOCALAPPDATA = saved;

// Case 5 (network): fresh install auto-downloads into versions\0.1.0\
if (process.env.RUN_DOWNLOAD === "1") {
  mounts.length = 0;
  const fresh = mkdtempSync(join(tmpdir(), "gs-mcp-test-"));
  process.env.LOCALAPPDATA = fresh;
  await apply(ctx, {});
  assert.ok(mounts[0], "mounted after auto-download");
  assert.ok(mounts[0].command.includes(join("versions", "0.1.0")), "installed into versioned dir: " + mounts[0].command);
  console.log("case5 ok: auto-download mounted at", mounts[0].command);
  // Case 6: update check runs after mount; with local 0.1.0 vs latest 0.1.0 it should stay silent
  await sleep(3000);
  const updateMsg = logs.info.some((l) => l.includes("update"));
  console.log(updateMsg ? "case6: update-check log seen" : "case6: no update needed (already latest)");
}

console.log("ALL OK");
