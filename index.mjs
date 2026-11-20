import { existsSync, mkdirSync, createWriteStream, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";

export const name = "dsh-ghostscreen-mcp";
export const inject = ["tools"];

const RELEASES_URL = "https://github.com/woodtong/neutrino/releases";
const LATEST_RELEASE_API = "https://api.github.com/repos/woodtong/neutrino/releases/latest";
const ASSET_NAME_RE = /^GhostScreen-[\w.\-]+-win-x64\.zip$/;
const CHECK_TTL_MS = 24 * 60 * 60 * 1000; // online update check at most once a day
const UA = "dsh-ghostscreen-mcp";

function log(ctx, ...args) {
  ctx.logger?.info?.(...args);
}

function gsPaths() {
  const root = process.env.LOCALAPPDATA;
  if (!root) return undefined;
  const app = join(root, "GhostScreen", "app");
  return { app, versions: join(app, "versions"), downloads: join(root, "GhostScreen", "downloads"), check: join(app, "update-check.json") };
}

/** "0.1.0" / "v1.2.3-beta" -> [0,1,2] (prereleases order below their release). */
function parseVersion(s) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(s ?? "");
  return m ? m.slice(1).map(Number) : undefined;
}
function cmpVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** Best installed version under app\versions\<ver>\mcp\GhostScreen.Mcp.exe. */
function bestInVersions(versionsDir) {
  let best;
  try {
    for (const entry of readdirSync(versionsDir)) {
      const v = parseVersion(entry);
      if (!v) continue;
      const exe = join(versionsDir, entry, "mcp", "GhostScreen.Mcp.exe");
      if (!existsSync(exe)) continue;
      if (!best || cmpVersion(v, best.v) > 0) best = { v, exe, dir: join(versionsDir, entry) };
    }
  } catch {
    /* not installed */
  }
  return best;
}

/** Legacy layouts: install.ps1 app\mcp\, flat auto-download app\mcp\, app\GhostScreen-<ver>\mcp\, GhostScreen root. */
function legacyExe(paths) {
  const candidates = [
    { exe: join(paths.app, "mcp", "GhostScreen.Mcp.exe"), vFrom: join(paths.app, "VERSION") },
    { exe: join(paths.app, "GhostScreen.Mcp.exe") },
    { exe: join(paths.app, "..", "GhostScreen.Mcp.exe") },
  ];
  // versioned-root dirs a user unzipped straight into app\
  try {
    for (const entry of readdirSync(paths.app)) {
      if (parseVersion(entry)) candidates.push({ exe: join(paths.app, entry, "mcp", "GhostScreen.Mcp.exe"), vFrom: join(paths.app, entry, "VERSION") });
    }
  } catch { /* app missing */ }
  for (const c of candidates) {
    if (existsSync(c.exe)) {
      let v = c.vFrom && existsSync(c.vFrom) ? parseVersion(readFileSync(c.vFrom, "utf8")) : undefined;
      if (!v) v = parseVersion(c.exe);
      return { exe: c.exe, v };
    }
  }
  return undefined;
}

/** Resolve the exe to mount: config/env pin wins, else newest installed version, else legacy. */
function findExistingExe(config) {
  const fromConfig = config?.exePath ?? config?.command;
  if (fromConfig && existsSync(fromConfig)) return { exe: fromConfig, v: undefined, pinned: true };
  const fromEnv = process.env.GHOSTSCREEN_MCP_EXE;
  if (fromEnv && existsSync(fromEnv)) return { exe: fromEnv, v: undefined, pinned: true };
  const paths = gsPaths();
  if (!paths) return undefined;
  const best = bestInVersions(paths.versions);
  if (best) return { exe: best.exe, v: best.v };
  return legacyExe(paths);
}

/** Latest release info {tag, version, url, name, size}; API first, quota-free fallback second. */
async function latestReleaseInfo() {
  let tag;
  try {
    const res = await fetch(LATEST_RELEASE_API, { headers: { "User-Agent": UA, Accept: "application/vnd.github+json" } });
    if (res.ok) {
      const release = await res.json();
      tag = release.tag_name;
      const asset = (release.assets ?? []).find((a) => ASSET_NAME_RE.test(a.name));
      if (asset) return { tag, version: parseVersion(tag), url: asset.browser_download_url, name: asset.name, size: asset.size };
    } else if (res.status !== 403 && res.status !== 429) {
      throw new Error(`GitHub API ${res.status}`);
    }
  } catch { /* fall through to the redirect path */ }
  const page = await fetch(`${RELEASES_URL}/latest`, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!page.ok) throw new Error(`releases/latest ${page.status}`);
  const tagMatch = page.url.match(/\/tag\/([^/?#]+)$/);
  if (!tagMatch) throw new Error("could not determine latest tag");
  tag = tagMatch[1];
  const guessed = `GhostScreen-${tag.replace(/^v/, "")}-win-x64.zip`;
  const guessedUrl = `${RELEASES_URL}/download/${tag}/${guessed}`;
  const head = await fetch(guessedUrl, { method: "HEAD", headers: { "User-Agent": UA } });
  if (head.ok) return { tag, version: parseVersion(tag), url: guessedUrl, name: guessed, size: Number(head.headers.get("content-length") ?? 0) };
  const assetsPage = await fetch(`${RELEASES_URL}/expanded_assets/${tag}`, { headers: { "User-Agent": UA } });
  if (assetsPage.ok) {
    const html = await assetsPage.text();
    const m = html.match(/href="([^"]*\/download\/[^"]*\/(GhostScreen-[\w.\-]+-win-x64\.zip))"/);
    if (m) return { tag, version: parseVersion(tag), url: new URL(m[1], RELEASES_URL).href, name: m[2], size: 0 };
  }
  throw new Error(`no win-x64 zip asset on ${tag}`);
}

async function downloadTo(url, dest, ctx) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let done = 0;
  let lastPct = -1;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    done += chunk.length;
    if (total) {
      const pct = Math.floor((done / total) * 10) * 10;
      if (pct > lastPct && pct < 100) {
        lastPct = pct;
        log(ctx, `[dsh-ghostscreen-mcp] download ${pct}% (${(done / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MiB)`);
      }
    }
  });
  await pipeline(body, createWriteStream(dest));
}

function expandZip(zip, destDir) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Expand-Archive exit ${code}`))));
  });
}

/** Download + unpack a release zip into app\versions\<ver>\. Returns the exe path or undefined. */
async function installRelease(rel, ctx, paths) {
  mkdirSync(paths.downloads, { recursive: true });
  mkdirSync(paths.versions, { recursive: true });
  log(ctx, `[dsh-ghostscreen-mcp] downloading GhostScreen ${rel.name} (${(rel.size / 1048576).toFixed(0)} MiB) from ${RELEASES_URL} ...`);
  const zipPath = join(paths.downloads, rel.name);
  const cached = existsSync(zipPath) && rel.size > 0 && statSync(zipPath).size === rel.size;
  if (cached) {
    log(ctx, `[dsh-ghostscreen-mcp] using cached ${rel.name}, skipping download`);
  } else {
    await downloadTo(rel.url, zipPath, ctx);
  }
  log(ctx, "[dsh-ghostscreen-mcp] download complete, extracting ...");
  const dest = join(paths.versions, rel.tag.replace(/^v/, ""));
  await expandZip(zipPath, dest);
  const exe = join(dest, "mcp", "GhostScreen.Mcp.exe");
  if (!existsSync(exe)) throw new Error("GhostScreen.Mcp.exe missing after extract");
  log(ctx, `[dsh-ghostscreen-mcp] GhostScreen ${rel.tag} installed at ${exe}`);
  return exe;
}

/** First install: no exe anywhere -> fetch latest into versions\<ver>\. */
async function autoDownloadExe(ctx, paths) {
  try {
    const rel = await latestReleaseInfo();
    const exe = await installRelease(rel, ctx, paths);
    return { exe, v: rel.version };
  } catch (error) {
    ctx.logger?.error?.(`[dsh-ghostscreen-mcp] auto-download failed: ${error?.message ?? error}`);
    return undefined;
  }
}

/** Daily online freshness check; auto-installs newer releases for the NEXT restart. Fire-and-forget. */
async function updateCheck(mounted, config, ctx, paths) {
  if (config.autoUpdate === false) return;
  if (mounted.pinned) return; // explicit exePath/env: user manages the binary
  try {
    const now = Date.now();
    try {
      const prev = JSON.parse(readFileSync(paths.check, "utf8"));
      if (now - prev.ts < CHECK_TTL_MS) return;
    } catch { /* no cache yet */ }
    const rel = await latestReleaseInfo();
    writeFileSync(paths.check, JSON.stringify({ ts: now, tag: rel.tag }));
    const local = mounted.v ?? [0, 0, 0];
    if (!rel.version || cmpVersion(rel.version, local) <= 0) return;
    const haveNewer = bestInVersions(paths.versions);
    if (haveNewer && cmpVersion(haveNewer.v, rel.version) >= 0) {
      log(ctx, `[dsh-ghostscreen-mcp] GhostScreen ${rel.tag} is downloaded; restart DSH to switch to it.`);
      return;
    }
    log(ctx, `[dsh-ghostscreen-mcp] GhostScreen update available: ${local.join(".")} -> ${rel.tag}. Downloading in background ...`);
    await installRelease(rel, ctx, paths);
    log(ctx, "[dsh-ghostscreen-mcp] update installed. Restart DSH to use the new version.");
  } catch (error) {
    log(ctx, `[dsh-ghostscreen-mcp] update check skipped: ${error?.message ?? error}`);
  }
}

const MISSING_EXE_HELP = [
  "[dsh-ghostscreen-mcp] GhostScreen.Mcp.exe not found - the ghostscreen tools are NOT mounted.",
  "Tried, in order: config exePath -> %GHOSTSCREEN_MCP_EXE% -> %LOCALAPPDATA%\\GhostScreen\\app (versions\\<ver>\\, mcp\\, root).",
  "To fix, pick ONE of:",
  "  1. Just restart DSH: auto-download (enabled by default) fetches the latest",
  "     win-x64 zip from " + RELEASES_URL + " and unpacks it to",
  "     %LOCALAPPDATA%\\GhostScreen\\app\\versions\\<version>\\ automatically.",
  "     Disable with config autoDownload:false / autoUpdate:false.",
  "  2. Or download the zip manually and run scripts/install.ps1 from it.",
  "  3. Or point this plugin at any GhostScreen.Mcp.exe via the GHOSTSCREEN_MCP_EXE",
  "     environment variable or config exePath in your profile's cordis.patch.yml.",
  "Then restart DSH. The rest of this session is unaffected.",
].join("\n");

/**
 * Mount the GhostScreen MCP server (stdio) for every DSH session.
 *
 * GhostScreen gives agents an invisible screen: it parks real windows outside
 * the virtual desktop, captures them with PrintWindow, and drives them with
 * window messages / UIA behind a human consent gate. The message/CDP input
 * paths never steal focus; UIA actions ask first when a human is active.
 *
 * Version policy: the newest installed release under app\versions\ is mounted;
 * a once-a-day online check (config.autoUpdate, default on) downloads newer
 * releases in the background so the next restart picks them up. A pinned
 * exePath / GHOSTSCREEN_MCP_EXE install is never auto-updated.
 */
export async function apply(ctx, config = {}) {
  const paths = gsPaths();
  let mounted = paths ? findExistingExe(config) : undefined;

  if (!mounted && paths && config.autoDownload !== false) {
    mounted = await autoDownloadExe(ctx, paths);
  }

  if (!mounted) {
    ctx.logger?.error?.(MISSING_EXE_HELP);
    return;
  }

  try {
    ctx.plugin(mcpClient, {
      transport: "stdio",
      serverName: "ghostscreen",
      command: mounted.exe,
      args: config.args ?? [],
      env: config.env ?? {},
      toolCallTimeoutMs: config.toolCallTimeoutMs,
      failOnStartupError: false,
      reconnect: {
        enabled: true,
        initialDelayMs: 500,
        maxDelayMs: 30000,
        maxAttempts: 10,
      },
    });
  } catch (error) {
    ctx.logger?.error?.("[dsh-ghostscreen-mcp] mount failed:", error);
  }

  if (paths && !mounted.pinned && config.autoUpdate !== false) {
    // Non-blocking: tools mount immediately with the current binary.
    void updateCheck(mounted, config, ctx, paths);
  }
}
