import { existsSync, mkdirSync, createWriteStream, readdirSync } from "node:fs";
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
const DEFAULT_INSTALL_DIRS = [
  // Layout produced by WindowsForAgent scripts/install.ps1
  ["LOCALAPPDATA", ["GhostScreen", "app", "mcp", "GhostScreen.Mcp.exe"]],
  // Auto-download / manual-unzip layout:
  // %LOCALAPPDATA%\GhostScreen\app\GhostScreen-<ver>\mcp\GhostScreen.Mcp.exe
  // (only the newest one matters; both dirs below are checked in order.)
  ["LOCALAPPDATA", ["GhostScreen", "app"]],
  // Manual-unzip convention: drop the release's mcp\GhostScreen.Mcp.exe
  // (or the exe itself) directly into %LOCALAPPDATA%\GhostScreen\
  ["LOCALAPPDATA", ["GhostScreen", "GhostScreen.Mcp.exe"]],
];

function log(ctx, ...args) {
  ctx.logger?.info?.(...args);
}

/** Find GhostScreen.Mcp.exe under a directory (zip layout: <root>\mcp\GhostScreen.Mcp.exe). */
function exeUnderDir(dir) {
  // direct: dir\GhostScreen.Mcp.exe
  const direct = join(dir, "GhostScreen.Mcp.exe");
  if (existsSync(direct)) return direct;
  // flat zip layout: dir\mcp\GhostScreen.Mcp.exe
  const inMcp = join(dir, "mcp", "GhostScreen.Mcp.exe");
  if (existsSync(inMcp)) return inMcp;
  // versioned root: dir\GhostScreen-<ver>\mcp\GhostScreen.Mcp.exe
  try {
    for (const entry of readdirSync(dir)) {
      const mcpExe = join(dir, entry, "mcp", "GhostScreen.Mcp.exe");
      if (existsSync(mcpExe)) return mcpExe;
    }
  } catch {
    /* dir unreadable */
  }
  return undefined;
}

function findExistingExe(config) {
  const fromConfig = config?.exePath ?? config?.command;
  if (fromConfig && existsSync(fromConfig)) return fromConfig;
  const fromEnv = process.env.GHOSTSCREEN_MCP_EXE;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const root = process.env.LOCALAPPDATA;
  if (!root) return undefined;
  for (const [envVar, parts] of DEFAULT_INSTALL_DIRS) {
    const dir = join(process.env[envVar], ...parts);
    if (!existsSync(dir)) continue;
    if (parts[parts.length - 1] === "GhostScreen.Mcp.exe") {
      if (existsSync(dir)) return dir;
    } else {
      const found = exeUnderDir(dir);
      if (found) return found;
    }
  }
  return undefined;
}

async function latestAssetUrl() {
  // Primary: the REST API (rate-limited to 60/h per IP unauthenticated).
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { "User-Agent": "dsh-ghostscreen-mcp", Accept: "application/vnd.github+json" },
    });
    if (res.ok) {
      const release = await res.json();
      const asset = (release.assets ?? []).find((a) => ASSET_NAME_RE.test(a.name));
      if (asset) return { url: asset.browser_download_url, name: asset.name, size: asset.size };
      throw new Error(`no win-x64 zip asset on ${release.tag_name ?? "latest"}`);
    }
    if (res.status !== 403 && res.status !== 429) throw new Error(`GitHub API ${res.status}`);
    // fall through to the API-less path
  } catch (error) {
    if (!/GitHub API|no win-x64/.test(error?.message ?? "")) throw error;
  }
  // Fallback (no API quota): releases/latest redirects to releases/tag/<tag>.
  const page = await fetch(`${RELEASES_URL}/latest`, {
    headers: { "User-Agent": "dsh-ghostscreen-mcp" },
    redirect: "follow",
  });
  if (!page.ok) throw new Error(`releases/latest ${page.status}`);
  const tagMatch = page.url.match(/\/tag\/([^/?#]+)$/);
  if (!tagMatch) throw new Error("could not determine latest tag");
  const tag = tagMatch[1];
  // Asset names strip the leading "v": v0.1.0 -> GhostScreen-0.1.0-win-x64.zip
  const guessed = `GhostScreen-${tag.replace(/^v/, "")}-win-x64.zip`;
  const guessedUrl = `${RELEASES_URL}/download/${tag}/${guessed}`;
  const head = await fetch(guessedUrl, { method: "HEAD", headers: { "User-Agent": "dsh-ghostscreen-mcp" } });
  if (head.ok) return { url: guessedUrl, name: guessed, size: Number(head.headers.get("content-length") ?? 0) };
  // Last resort: parse the expanded-assets fragment for a matching name.
  const assetsPage = await fetch(`${RELEASES_URL}/expanded_assets/${tag}`, {
    headers: { "User-Agent": "dsh-ghostscreen-mcp" },
  });
  if (assetsPage.ok) {
    const html = await assetsPage.text();
    const m = html.match(/href="([^"]*\/download\/[^"]*\/(GhostScreen-[\w.\-]+-win-x64\.zip))"/);
    if (m) return { url: new URL(m[1], RELEASES_URL).href, name: m[2], size: 0 };
  }
  throw new Error(`no win-x64 zip asset on ${tag}`);
}

async function downloadTo(url, dest, ctx) {
  const res = await fetch(url, { headers: { "User-Agent": "dsh-ghostscreen-mcp" } });
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
        log(ctx, `[dsh-ghostscreen-mcp] download ${(pct).toFixed(0)}% (${(done / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MiB)`);
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

/**
 * Fetch and unpack the latest GhostScreen win-x64 release under
 * %LOCALAPPDATA%\GhostScreen\app\ (zip layout: GhostScreen-<ver>\mcp\GhostScreen.Mcp.exe).
 * Returns the exe path, or undefined on any failure (callers fall back to guidance).
 */
async function autoDownloadExe(ctx) {
  const root = process.env.LOCALAPPDATA;
  if (!root) return undefined;
  const gsRoot = join(root, "GhostScreen");
  const dlDir = join(gsRoot, "downloads");
  const appDir = join(gsRoot, "app");
  try {
    mkdirSync(dlDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });
    const { url, name, size } = await latestAssetUrl();
    log(ctx, `[dsh-ghostscreen-mcp] downloading latest GhostScreen (${name}, ${(size / 1048576).toFixed(0)} MiB) from ${RELEASES_URL} ...`);
    const zipPath = join(dlDir, name);
    await downloadTo(url, zipPath, ctx);
    log(ctx, "[dsh-ghostscreen-mcp] download complete, extracting ...");
    await expandZip(zipPath, appDir);
    const exe = exeUnderDir(appDir);
    if (exe) log(ctx, `[dsh-ghostscreen-mcp] GhostScreen installed at ${exe}`);
    return exe;
  } catch (error) {
    ctx.logger?.error?.(`[dsh-ghostscreen-mcp] auto-download failed: ${error?.message ?? error}`);
    return undefined;
  }
}

const MISSING_EXE_HELP = [
  "[dsh-ghostscreen-mcp] GhostScreen.Mcp.exe not found - the ghostscreen tools are NOT mounted.",
  "Tried, in order: config exePath -> %GHOSTSCREEN_MCP_EXE% -> %LOCALAPPDATA%\\GhostScreen (app\\, app\\mcp\\, root).",
  "To fix, pick ONE of:",
  "  1. Just restart DSH: auto-download (enabled by default) fetches the latest",
  "     win-x64 zip from " + RELEASES_URL + " and unpacks it to",
  "     %LOCALAPPDATA%\\GhostScreen\\app\\ automatically. Disable with",
  "       - id: ghostscreen-mcp-runtime",
  "         name: dsh-ghostscreen-mcp",
  "         config:",
  "           autoDownload: false",
  "  2. Or download the zip manually and run scripts/install.ps1 from it, which",
  "     installs to %LOCALAPPDATA%\\GhostScreen\\app\\mcp\\GhostScreen.Mcp.exe.",
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
 * Startup failure is contained: if the exe is missing, the plugin first tries
 * to auto-download the latest release (config.autoDownload, default true);
 * if that is disabled or fails it logs setup guidance and the session keeps
 * working without the ghostscreen tools.
 */
export async function apply(ctx, config = {}) {
  let exe = findExistingExe(config);

  if (!exe && config.autoDownload !== false) {
    exe = await autoDownloadExe(ctx);
  }

  if (!exe) {
    ctx.logger?.error?.(MISSING_EXE_HELP);
    return;
  }

  try {
    ctx.plugin(mcpClient, {
      transport: "stdio",
      serverName: "ghostscreen",
      command: exe,
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
}
