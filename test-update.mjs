// Live test: stale main body (0.0.1) must trigger update check and auto-install latest.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert";

const fresh = mkdtempSync(join(tmpdir(), "gs-upd-"));
process.env.LOCALAPPDATA = fresh;
const logs = [];
const mounts = [];
const ctx = {
  logger: { info: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push("E " + a.join(" ")) },
  plugin: (_c, opts) => mounts.push(opts),
};

const { apply } = await import("./index.mjs");
mkdirSync(join(fresh, "GhostScreen", "app", "versions", "0.0.1", "mcp"), { recursive: true });
writeFileSync(join(fresh, "GhostScreen", "app", "versions", "0.0.1", "mcp", "GhostScreen.Mcp.exe"), "stub");
writeFileSync(join(fresh, "GhostScreen", "app", "versions", "0.0.1", "VERSION"), "0.0.1");

await apply(ctx, {});
assert.ok(mounts[0].command.includes("0.0.1"), "old version mounted first");

// poll until update finished (download ~207MB) or timeout 10min
const deadline = Date.now() + 600000;
while (Date.now() < deadline) {
  if (existsSync(join(fresh, "GhostScreen", "app", "versions", "0.1.0", "mcp", "GhostScreen.Mcp.exe"))) break;
  await new Promise((r) => setTimeout(r, 5000));
}
const upgraded = existsSync(join(fresh, "GhostScreen", "app", "versions", "0.1.0", "mcp", "GhostScreen.Mcp.exe"));
// the final "Restart DSH" log lands right after the exe file appears - allow a small grace
for (let i = 0; i < 20 && !logs.some((l) => l.includes("Restart DSH")); i++) {
  await new Promise((r) => setTimeout(r, 500));
}
console.log(logs.join("\n"));
assert.ok(upgraded, "latest version auto-installed alongside old one");
assert.ok(logs.some((l) => l.includes("update available")), "update-available notice logged");
assert.ok(logs.some((l) => l.includes("Restart DSH")), "restart hint logged");
console.log("UPDATE TEST OK: 0.0.1 detected stale -> 0.1.0 downloaded for next restart");
