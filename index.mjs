import {
  existsSync, mkdirSync, createReadStream, createWriteStream, readdirSync, readFileSync, rmSync, renameSync, statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { Readable } from "node:stream";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import Schema from "@deepseek-ai/schemastery";

export const name = "dsh-ghostscreen-mcp";
export const inject = ["tools"];

/**
 * Editable from Plugins -> GhostScreen MCP -> Configure.
 * Every field is volatile: saving in the settings page commits the new value
 * into the running plugin without a fiber remount, and the `loader/volatile-update`
 * listener below remounts the MCP bridge with the new launch options.
 * (Schema must be the DSH schemastery build, which wraps volatile fields in
 * cosmokit Volatile refs - that is what the loader commits on edit.)
 *
 * `exePath` is a developer escape hatch: it stays accepted (and honoured) so a
 * locally built GhostScreen.Mcp.exe can be pinned from cordis.patch.yml, but the
 * configuration page never shows it - end users always run the newest managed
 * release. Same for the GHOSTSCREEN_MCP_EXE environment variable.
 */
export const Config = Schema.object({
  exePath: Schema.string().volatile(),
  args: Schema.array(Schema.string()).volatile(),
  env: Schema.dict(Schema.string()).volatile(),
  toolCallTimeoutMs: Schema.number().volatile(),
});

/** Unwrap a cosmokit Volatile ref (DSH schemastery build) to its plain value. */
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");
function live(value) {
  return typeof value === "object" && value !== null && VOLATILE_WRITE in value ? value.get() : value;
}

/** Plain snapshot of the live config: volatile fields unwrapped, defaults applied. */
function snapshot(config) {
  return {
    exePath: live(config?.exePath) ?? live(config?.command),
    args: live(config?.args) ?? [],
    env: live(config?.env) ?? {},
    toolCallTimeoutMs: live(config?.toolCallTimeoutMs),
  };
}

const REPO = "woodtong/neutrino";
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const RELEASES_LIST_API = `https://api.github.com/repos/${REPO}/releases?per_page=10`;
const RELEASES_ATOM = `https://github.com/${REPO}/releases.atom`;
const STATUS_PATH = "/ghostscreen-mcp/status";
const ASSET_NAME_RE = /^GhostScreen-[\w.\-]+-win-x64\.zip$/;
const UA = "dsh-ghostscreen-mcp";

/** In-flight downloads, aborted when the owning fiber is disposed (remount, disable). */
const activeDownloads = new Set();
const META_TIMEOUT_MS = 20_000;

function log(ctx, ...args) {
  ctx.logger?.info?.(...args);
}

function gsPaths() {
  const root = process.env.LOCALAPPDATA;
  if (!root) return undefined;
  const app = join(root, "GhostScreen", "app");
  return { app, versions: join(app, "versions"), downloads: join(root, "GhostScreen", "downloads") };
}

/* -------------------------------------------------------------------- */
/* Versions                                                             */
/* -------------------------------------------------------------------- */

/** "0.1.0" / "v0.4.0-beta.2" -> {v:[0,4,0], pre:"beta.2", raw:"0.4.0-beta.2"}. */
function parseVer(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.\-]*))?/.exec(String(text ?? "").trim());
  if (!m) return undefined;
  return { v: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "", raw: String(text).trim().replace(/^v/, "") };
}

/** Semver order; a release sorts above its own prereleases. */
function cmpVer(a, b) {
  for (let i = 0; i < 3; i++) if (a.v[i] !== b.v[i]) return a.v[i] - b.v[i];
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre < b.pre ? -1 : 1;
}

function cmpVerDesc(a, b) {
  return cmpVer(a, b) * -1;
}

/** Best installed version under app\versions\<ver>\mcp\GhostScreen.Mcp.exe. */
function bestInVersions(versionsDir) {
  let best;
  try {
    for (const entry of readdirSync(versionsDir)) {
      const version = parseVer(entry);
      if (!version) continue;
      const exe = join(versionsDir, entry, "mcp", "GhostScreen.Mcp.exe");
      if (!existsSync(exe)) continue;
      if (!best || cmpVer(version, best.version) > 0) best = { version, exe, dir: join(versionsDir, entry) };
    }
  } catch {
    /* not installed */
  }
  return best;
}

/**
 * Non-intrusive package self-check. A release zip is expected to carry
 * `mcp\GhostScreen.Mcp.exe` and `GhostScreen.Notifier\GhostScreen.Notifier.exe`
 * (the notifier folder appeared in 0.2.0, so older packages legitimately lack
 * it). Results are reported on the configuration page only: mounting, updating
 * and cleanup never consult this, and nothing is ever repaired automatically.
 */
function inspectPackage(dir) {
  if (!dir) return null;
  const required = [
    { key: "mcp", label: "mcp\\GhostScreen.Mcp.exe", file: join(dir, "mcp", "GhostScreen.Mcp.exe") },
    {
      key: "notifier",
      label: "GhostScreen.Notifier\\GhostScreen.Notifier.exe",
      file: join(dir, "GhostScreen.Notifier", "GhostScreen.Notifier.exe"),
    },
  ];
  const missing = required.filter((entry) => !existsSync(entry.file)).map((entry) => entry.key);
  return { dir, checkedAt: Date.now(), missing };
}

/** One log line per divergent package; missing files are never fatal. */
function reportIntegrity(ctx, integrity) {
  if (!integrity || integrity.missing.length === 0) return;
  const labels = { mcp: "mcp\\GhostScreen.Mcp.exe", notifier: "GhostScreen.Notifier\\GhostScreen.Notifier.exe" };
  const names = integrity.missing.map((key) => labels[key] ?? key).join(", ");
  ctx.logger?.warn?.(
    `[dsh-ghostscreen-mcp] package self-check: missing ${names} under ${integrity.dir}` +
      " (the notifier folder only exists since GhostScreen 0.2.0; older packages lack it by design)",
  );
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
      if (parseVer(entry)) candidates.push({ exe: join(paths.app, entry, "mcp", "GhostScreen.Mcp.exe"), vFrom: join(paths.app, entry, "VERSION") });
    }
  } catch { /* app missing */ }
  for (const c of candidates) {
    if (existsSync(c.exe)) {
      let version = c.vFrom && existsSync(c.vFrom) ? parseVer(readFileSync(c.vFrom, "utf8")) : undefined;
      if (!version) version = parseVer(c.exe);
      return { exe: c.exe, version };
    }
  }
  return undefined;
}

/**
 * Resolve the exe to mount right now: developer override (config / env) wins,
 * then the newest managed release, then legacy layouts.
 */
function resolveMount(cfg, paths) {
  const fromConfig = cfg?.exePath ?? cfg?.command;
  if (fromConfig && existsSync(fromConfig)) return { exe: fromConfig, version: parseVer(fromConfig), source: "external" };
  const fromEnv = process.env.GHOSTSCREEN_MCP_EXE;
  if (fromEnv && existsSync(fromEnv)) return { exe: fromEnv, version: parseVer(fromEnv), source: "external" };
  if (!paths) return undefined;
  const best = bestInVersions(paths.versions);
  if (best) return { exe: best.exe, version: best.version, source: "managed", dir: best.dir };
  const legacy = legacyExe(paths);
  if (legacy) return { exe: legacy.exe, version: legacy.version, source: "legacy" };
  return undefined;
}

/* -------------------------------------------------------------------- */
/* Releases                                                             */
/* -------------------------------------------------------------------- */

/**
 * Run curl.exe and collect its output. GitHub release assets routinely need the
 * user's HTTP(S) proxy, which Node's fetch only honours with NODE_USE_ENV_PROXY,
 * while curl reads HTTPS_PROXY itself and follows the signed-URL redirect cleanly.
 */
function runCurl(args, { timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("curl.exe", args, { windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = timeoutMs ? setTimeout(() => child.kill(), timeoutMs) : undefined;
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 4 * 1048576) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function curlFailure({ code, stderr }) {
  const line = stderr.trim().split(/\r?\n/).filter(Boolean).pop();
  return new Error(`curl exit ${code}${line ? `: ${line}` : ""}`);
}

/** Text of a URL: fetch first (works on open networks), curl through the proxy as fallback. */
async function httpText(url, { accept } = {}) {
  try {
    const res = await fetch(url, {
      headers: accept ? { "User-Agent": UA, Accept: accept } : { "User-Agent": UA },
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
    if (!res.ok) throw Object.assign(new Error(`${url} -> HTTP ${res.status}`), { status: res.status });
    return await res.text();
  } catch (error) {
    const seconds = String(Math.max(8, Math.round(META_TIMEOUT_MS / 1000)));
    const out = await runCurl(["-sSL", "--fail", "--max-time", seconds, url], { timeoutMs: META_TIMEOUT_MS + 8000 });
    if (out.code !== 0) throw Object.assign(curlFailure(out), { cause: error });
    return out.stdout;
  }
}

async function fetchJson(url) {
  const text = await httpText(url, { accept: "application/vnd.github+json" });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} -> not JSON`);
  }
}

/** Newest published release (prereleases included) from the REST list API. */
async function latestFromApi() {
  const list = await fetchJson(RELEASES_LIST_API);
  const releases = (Array.isArray(list) ? list : []).filter((r) => r && !r.draft && r.tag_name && parseVer(r.tag_name));
  if (!releases.length) throw new Error("no published releases");
  releases.sort((a, b) => cmpVerDesc(parseVer(a.tag_name), parseVer(b.tag_name)));
  return releases[0];
}

/** Quota-free fallback: the releases Atom feed lists recent tags, prereleases included. */
async function latestTagFromAtom() {
  const xml = await httpText(RELEASES_ATOM);
  const tags = [...xml.matchAll(/releases\/tag\/([^"<>?\s]+)/g)].map((m) => {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  });
  const parsed = tags.map((tag) => ({ tag, version: parseVer(tag) })).filter((x) => x.version);
  if (!parsed.length) throw new Error("no release tags in atom feed");
  parsed.sort((a, b) => cmpVerDesc(a.version, b.version));
  return parsed[0].tag;
}

/** Locate the win-x64 zip of a tag (and its sha256 when the page exposes it). */
async function assetForTag(tag, apiRelease) {
  const fromApi = (apiRelease?.assets ?? []).find((a) => ASSET_NAME_RE.test(a.name));
  if (fromApi) {
    return {
      name: fromApi.name,
      url: fromApi.browser_download_url,
      size: Number(fromApi.size ?? 0),
      digest: String(fromApi.digest ?? "").replace(/^sha256:/, "") || undefined,
    };
  }
  let html;
  try {
    html = await httpText(`${RELEASES_URL}/expanded_assets/${encodeURIComponent(tag)}`);
  } catch { /* page unavailable: fall through to the guessed asset name */ }
  if (html) {
    const m = html.match(/href="([^"]*\/releases\/download\/[^"]*\/(GhostScreen-[^"/]+-win-x64\.zip))"/);
    if (m) {
      const at = html.indexOf(m[1]);
      const digest = at >= 0 ? (/sha256:([0-9a-f]{64})/.exec(html.slice(at)) ?? [])[1] : undefined;
      return { name: m[2], url: new URL(m[1], "https://github.com").href, size: 0, digest };
    }
  }
  const guessed = `GhostScreen-${tag.replace(/^v/, "")}-win-x64.zip`;
  const url = `${RELEASES_URL}/download/${tag}/${guessed}`;
  const head = await runCurl(["-sSIL", "--max-time", String(Math.round(META_TIMEOUT_MS / 1000)), url], {
    timeoutMs: META_TIMEOUT_MS + 8000,
  });
  if (head.code !== 0) throw new Error(`no win-x64 zip asset on ${tag}`);
  const size = Number((/(?:^|\n)content-length:\s*(\d+)/i.exec(head.stdout) ?? [])[1] ?? 0);
  return { name: guessed, url, size, digest: undefined };
}

/** {tag, version, name, url, size, digest} of the newest release; API first, Atom feed second. */
async function latestReleaseInfo() {
  let apiRelease;
  try {
    apiRelease = await latestFromApi();
  } catch { /* 403/429 or offline: the feed has no quota */ }
  const tag = apiRelease?.tag_name ?? (await latestTagFromAtom());
  const version = parseVer(tag);
  if (!version) throw new Error(`unparsable release tag ${tag}`);
  const asset = await assetForTag(tag, apiRelease);
  return { tag, version, ...asset };
}

/** The .sha256 sidecar next to the zip ("<hash>  <filename>"), when present. */
async function sidecarDigest(tag, name) {
  try {
    const text = await httpText(`${RELEASES_URL}/download/${tag}/${name}.sha256`);
    const token = text.trim().split(/\s+/)[0];
    return /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/* -------------------------------------------------------------------- */
/* Download / install                                                   */
/* -------------------------------------------------------------------- */

/**
 * curl transport. The stall watchdog matters: a proxy tunnel can stay open and
 * idle forever, and curl's own --speed-limit only fires once it sees traffic.
 * `offset > 0` resumes an interrupted attempt with `-C -`.
 */
function downloadViaCurl(url, tmp, ctx, state, totalBytes, ctl, offset = 0) {
  const STALL_MS = 90000;
  return new Promise((resolve, reject) => {
    const args = [
      "-L", "--fail", "--silent", "--show-error",
      "--retry", "3", "--retry-delay", "2",
      "--connect-timeout", "30", "--max-time", "1800",
    ];
    if (offset > 0) args.push("-C", "-");
    args.push("--output", tmp, url);
    const child = spawn("curl.exe", args, { windowsHide: true });
    let stderr = "";
    let settled = false;
    let done = offset;
    let lastStep = Math.floor(((offset / (totalBytes || offset || 1)) * 100) / 10) * 10;
    let lastMib = offset;
    let movedAt = Date.now();
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    };
    if (ctl?.signal) ctl.signal.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    const tick = setInterval(() => {
      let size = 0;
      try {
        size = statSync(tmp).size;
      } catch {
        /* curl has not created the file yet */
      }
      if (size > done) {
        done = size;
        movedAt = Date.now();
      }
      const total = totalBytes > 0 ? totalBytes : 0;
      state.progress = { done, total, pct: total ? Math.min(99, Math.floor((done / total) * 100)) : 0 };
      if (total) {
        const step = Math.floor(((done / total) * 100) / 10) * 10;
        if (step > lastStep && step < 100) {
          lastStep = step;
          log(ctx, `[dsh-ghostscreen-mcp] download ${step}% (${(done / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MiB)`);
        }
      } else if (done - lastMib >= 64 * 1048576) {
        lastMib = done;
        log(ctx, `[dsh-ghostscreen-mcp] download ${(done / 1048576).toFixed(0)} MiB`);
      }
      if (Date.now() - movedAt > STALL_MS) {
        stderr += "\ndownload stalled";
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        movedAt = Date.now() + STALL_MS * 10;
      }
    }, 700);
    const settle = (fn) => {
      if (settled) return;
      settled = true;
      clearInterval(tick);
      if (ctl?.signal) ctl.signal.removeEventListener("abort", onAbort);
      fn();
    };
    child.on("error", (error) => settle(() => reject(error)));
    child.on("close", (code) => settle(() => {
      if (code !== 0) {
        const line = stderr.trim().split(/\r?\n/).filter(Boolean).pop();
        reject(new Error(`curl exit ${code}${line ? `: ${line}` : ""}`));
        return;
      }
      try {
        resolve(statSync(tmp).size);
      } catch (error) {
        reject(error);
      }
    }));
  });
}

/**
 * Node fetch transport, used when curl fails (no curl.exe, proxy quirks, CDN
 * flakiness). `offset > 0` asks for the remaining bytes with a Range header and
 * appends to the same partial file.
 */
async function downloadViaFetch(url, tmp, ctx, state, totalBytes, ctl, offset = 0) {
  const STALL_MS = 90000;
  let idle = setTimeout(() => ctl.abort(new Error(`no data for ${STALL_MS / 1000} s`)), STALL_MS);
  let done = offset;
  let lastStep = Math.floor(((offset / (totalBytes || offset || 1)) * 100) / 10) * 10;
  let lastMib = offset;
  const headers = { "User-Agent": UA };
  if (offset > 0) headers.Range = `bytes=${offset}-`;
  const out = createWriteStream(tmp, { flags: offset > 0 ? "a" : "w" });
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: ctl.signal });
    if (offset > 0 && res.status !== 206) throw new Error(`HTTP ${res.status} (range not honored)`);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = totalBytes > 0 ? totalBytes : Number(res.headers.get("content-length") ?? 0) + offset;
    for await (const chunk of Readable.fromWeb(res.body)) {
      clearTimeout(idle);
      idle = setTimeout(() => ctl.abort(new Error(`no data for ${STALL_MS / 1000} s`)), STALL_MS);
      done += chunk.length;
      state.progress = { done, total, pct: total ? Math.min(99, Math.floor((done / total) * 100)) : 0 };
      if (total) {
        const step = Math.floor(((done / total) * 100) / 10) * 10;
        if (step > lastStep && step < 100) {
          lastStep = step;
          log(ctx, `[dsh-ghostscreen-mcp] download ${step}% (${(done / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MiB)`);
        }
      } else if (done - lastMib >= 64 * 1048576) {
        lastMib = done;
        log(ctx, `[dsh-ghostscreen-mcp] download ${(done / 1048576).toFixed(0)} MiB`);
      }
      if (!out.write(chunk)) await once(out, "drain");
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    return done;
  } catch (error) {
    out.destroy();
    throw error;
  } finally {
    clearTimeout(idle);
  }
}

/**
 * Download the release zip, trying curl first and node fetch second. Bytes that
 * already arrived survive a stalled or failed transport: the part file is keyed
 * per fiber (a remount must not collide with the previous fiber's open file) and
 * the next transport resumes from its length.
 */
async function downloadTo(url, dest, ctx, state, totalBytes = 0) {
  const stamp = Date.now().toString(36);
  const ctl = new AbortController();
  activeDownloads.add(ctl);
  const part = `${dest}.${stamp}.part`;
  const attempts = [
    { name: "curl", run: downloadViaCurl },
    { name: "node fetch", run: downloadViaFetch },
  ];
  const failures = [];
  try {
    for (const attempt of attempts) {
      if (ctl.signal.aborted) throw new Error("aborted");
      let offset = 0;
      try {
        offset = existsSync(part) ? statSync(part).size : 0;
      } catch {
        offset = 0;
      }
      try {
        if (offset > 0) log(ctx, `[dsh-ghostscreen-mcp] resuming download at ${(offset / 1048576).toFixed(0)} MiB via ${attempt.name}`);
        const size = await attempt.run(url, part, ctx, state, totalBytes, ctl, offset);
        if (!size) throw new Error("empty file");
        state.progress = { done: size, total: size, pct: 100 };
        rmSync(dest, { force: true });
        renameSync(part, dest);
        return;
      } catch (error) {
        failures.push(`${attempt.name}: ${error.message}`);
        if (ctl.signal.aborted) {
          rmSync(part, { force: true });
          throw new Error(`download aborted (${ctl.signal.reason?.message ?? "fiber disposed"})`);
        }
        log(ctx, `[dsh-ghostscreen-mcp] download via ${attempt.name} failed (${error.message}); trying the next transport`);
      }
    }
    rmSync(part, { force: true });
    throw new Error(`download failed — ${failures.join("; ")}`);
  } finally {
    activeDownloads.delete(ctl);
  }
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
 * Download, verify and unpack one release into app\versions\<ver>\.
 * The zip holds both halves of the product: mcp\ (the bridge this plugin runs)
 * and cli\ / tray\ (the rest of GhostScreen), so one install updates everything.
 */
async function installRelease(rel, ctx, paths, state) {
  mkdirSync(paths.downloads, { recursive: true });
  mkdirSync(paths.versions, { recursive: true });

  const finalDir = join(paths.versions, rel.version.raw);
  const finalExe = join(finalDir, "mcp", "GhostScreen.Mcp.exe");
  if (existsSync(finalExe)) return finalExe; // interrupted earlier run already unpacked it

  const zipPath = join(paths.downloads, rel.name);
  const cached = rel.size > 0 && existsSync(zipPath) && statSync(zipPath).size === rel.size;
  if (cached) {
    log(ctx, `[dsh-ghostscreen-mcp] reusing cached ${rel.name}`);
  } else {
    log(ctx, `[dsh-ghostscreen-mcp] downloading GhostScreen ${rel.tag} (${(rel.size / 1048576).toFixed(0)} MiB) from ${RELEASES_URL} ...`);
    await downloadTo(rel.url, zipPath, ctx, state, rel.size);
  }

  const expected = rel.digest ?? (await sidecarDigest(rel.tag, rel.name));
  if (expected) {
    const actual = await sha256File(zipPath);
    if (actual !== expected.toLowerCase()) {
      rmSync(zipPath, { force: true });
      throw new Error(`checksum mismatch for ${rel.name}`);
    }
    log(ctx, `[dsh-ghostscreen-mcp] sha256 ok (${expected.slice(0, 12)}…)`);
  } else {
    log(ctx, "[dsh-ghostscreen-mcp] no sha256 published; skipping checksum verification");
  }

  const staging = join(paths.versions, `.staging-${process.pid}-${Date.now()}`);
  try {
    await expandZip(zipPath, staging);
    if (!existsSync(join(staging, "mcp", "GhostScreen.Mcp.exe"))) throw new Error("GhostScreen.Mcp.exe missing after extract");
    const versionFile = join(staging, "VERSION");
    if (existsSync(versionFile)) {
      const packed = parseVer(readFileSync(versionFile, "utf8"));
      if (packed && cmpVer(packed, rel.version) !== 0) {
        log(ctx, `[dsh-ghostscreen-mcp] warning: package VERSION ${packed.raw} differs from tag ${rel.tag}`);
      }
    }
    rmSync(finalDir, { recursive: true, force: true });
    renameSync(staging, finalDir);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  rmSync(zipPath, { force: true });
  log(ctx, `[dsh-ghostscreen-mcp] GhostScreen ${rel.tag} installed at ${finalExe}`);
  return finalExe;
}

/** Keep the newest managed release (the one that will run next), drop every older one. */
function cleanupVersions(ctx, paths, keepDir) {
  try {
    for (const entry of readdirSync(paths.versions)) {
      const dir = join(paths.versions, entry);
      if (dir === keepDir) continue;
      if (!entry.startsWith(".staging-") && !parseVer(entry)) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
        if (!entry.startsWith(".staging-")) log(ctx, `[dsh-ghostscreen-mcp] removed old version ${entry}`);
      } catch (error) {
        // Locked by a still-running cli/tray of the previous install: retry next start.
        log(ctx, `[dsh-ghostscreen-mcp] cleanup deferred for ${entry}: ${error?.code ?? error}`);
      }
    }
  } catch {
    /* versions dir missing */
  }
  try {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const file of readdirSync(paths.downloads)) {
      if (!/\.(zip|part|tmp|sha256)$/i.test(file)) continue;
      const full = join(paths.downloads, file);
      try {
        // A .part can still be an active download of a fiber this process just replaced.
        if (/\.(part|tmp)$/i.test(file) && statSync(full).mtimeMs > cutoff) continue;
        rmSync(full, { force: true });
      } catch {
        /* in use: retry next start */
      }
    }
  } catch {
    /* no downloads dir */
  }
}

const MISSING_EXE_HELP = [
  "[dsh-ghostscreen-mcp] GhostScreen.Mcp.exe is unavailable - the ghostscreen tools are NOT mounted.",
  "Every start checks " + RELEASES_URL + " for the newest release and installs it",
  "silently into %LOCALAPPDATA%\\GhostScreen\\app\\versions\\<version>\\ (bridge + cli + tray).",
  "That download just failed; see the update status in the plugin page, or fetch it by hand:",
  "  " + RELEASES_URL,
  "Developer override (not shown in the page): config exePath in cordis.patch.yml or %GHOSTSCREEN_MCP_EXE%.",
].join("\n");

/* -------------------------------------------------------------------- */
/* Plugin                                                               */
/* -------------------------------------------------------------------- */

/**
 * Mount the GhostScreen MCP server (stdio) for every DSH session.
 *
 * GhostScreen gives agents an invisible screen: it parks real windows outside
 * the virtual desktop, captures them with PrintWindow, and drives them with
 * window messages / UIA behind a human consent gate. The message/CDP input
 * paths never steal focus; UIA actions ask first when a human is active.
 *
 * Version policy: the newest managed release under app\versions\ is mounted at
 * startup; every start also checks GitHub for a newer release and downloads it
 * silently, so the next start runs it and deletes the older copies. There is no
 * version picker - the page only reports what is running and what is pending.
 */
export async function apply(ctx, config = {}) {
  const paths = gsPaths();

  const state = {
    phase: "idle", // idle | checking | downloading | ready | error
    checkedAt: null,
    current: null, // { version, exe, source: 'managed' | 'external' | 'legacy' }
    latest: null, // { tag, version, name }
    progress: null, // { done, total, pct }
    error: null, // { message, at }
    integrity: null, // { dir, checkedAt, missing: ('mcp' | 'notifier')[] }
  };

  let inflight = null;

  /** Check GitHub and silently install a newer release. Single-flight; never throws. */
  function refresh(reason) {
    if (!paths) return Promise.resolve(state);
    if (inflight) return inflight;
    inflight = (async () => {
      state.phase = "checking";
      state.error = null;
      try {
        const rel = await latestReleaseInfo();
        state.checkedAt = Date.now();
        state.latest = { tag: rel.tag, version: rel.version.raw, name: rel.name };
        const installed = bestInVersions(paths.versions);
        if (installed && cmpVer(rel.version, installed.version) <= 0) {
          state.integrity = inspectPackage(installed.dir);
          reportIntegrity(ctx, state.integrity);
          state.phase = "idle";
          state.progress = null;
          log(ctx, `[dsh-ghostscreen-mcp] GhostScreen ${installed.version.raw} is up to date (latest ${rel.tag})`);
          return state;
        }
        state.phase = "downloading";
        const exe = await installRelease(rel, ctx, paths, state);
        // Self-check right after extraction; advisory only, never fatal.
        state.integrity = inspectPackage(dirname(dirname(exe)));
        reportIntegrity(ctx, state.integrity);
        state.progress = null;
        state.phase = "ready";
        log(ctx, `[dsh-ghostscreen-mcp] GhostScreen ${rel.tag} is ready; restart DSH to activate it.`);
      } catch (error) {
        state.phase = "error";
        state.progress = null;
        state.error = { message: String(error?.message ?? error), at: Date.now() };
        ctx.logger?.warn?.(`[dsh-ghostscreen-mcp] update ${reason === "bootstrap" ? "download" : "check"} failed: ${state.error.message}`);
      }
      return state;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  /** JSON for the configuration page: what runs now, what is coming, what failed. */
  function statusPayload() {
    const managed = [];
    if (paths) {
      try {
        for (const entry of readdirSync(paths.versions)) {
          const version = parseVer(entry);
          if (!version) continue;
          if (!existsSync(join(paths.versions, entry, "mcp", "GhostScreen.Mcp.exe"))) continue;
          managed.push({ version: version.raw, dir: join(paths.versions, entry) });
        }
        managed.sort((a, b) => cmpVerDesc(parseVer(a.version), parseVer(b.version)));
      } catch {
        /* not installed yet */
      }
    }
    return {
      ok: true,
      phase: state.phase,
      checkedAt: state.checkedAt,
      current: state.current,
      latest: state.latest,
      progress: state.progress,
      error: state.error,
      integrity: state.integrity,
      managed,
      versionsDir: paths?.versions ?? null,
    };
  }

  // The page cannot call host services directly, so update progress is reported
  // over one named GET route; the browser request carries the page's cookies and
  // therefore passes the desktop build's browser-access gate.
  ctx.inject(["webServer"], (wsCtx) => {
    ctx.effect(
      () => {
        const dispose = wsCtx.webServer.register({
          kind: "exact",
          path: STATUS_PATH,
          resource: async (request) => {
            let manual = false;
            try {
              manual = new URL(request.url, "http://localhost").searchParams.get("refresh") === "1";
            } catch {
              /* not a URL */
            }
            if (manual) void refresh("manual");
            return new Response(JSON.stringify(statusPayload()), {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
            });
          },
        });
        log(ctx, `[dsh-ghostscreen-mcp] update status route: ${STATUS_PATH}`);
        return dispose;
      },
      "ghostscreen-mcp: update status route",
    );
  });

  // A remount (config save, plugin disable) must not leave a download running in
  // the old fiber: it keeps writing into app\downloads and locks the file.
  ctx.effect(
    () => () => {
      for (const ctl of activeDownloads) {
        try {
          ctl.abort(new Error("bridge fiber disposed"));
        } catch {
          /* already settled */
        }
      }
      activeDownloads.clear();
    },
    "ghostscreen-mcp: abort in-flight downloads",
  );

  let bridgeFiber = null;
  let generation = 0;

  /** Resolve + mount the stdio bridge. Safe to call again after dispose(); a
   *  generation counter guards against double mounts racing a download. */
  async function mountBridge(allowDownload) {
    const gen = ++generation;
    const cfg = snapshot(config);

    let mounted = paths ? resolveMount(cfg, paths) : undefined;
    if (!mounted && paths && allowDownload) {
      log(ctx, "[dsh-ghostscreen-mcp] no local GhostScreen install; fetching the latest release ...");
      await refresh("bootstrap");
      if (gen !== generation) return;
      mounted = resolveMount(cfg, paths);
    }
    if (gen !== generation) return;

    if (!mounted) {
      state.current = null;
      ctx.logger?.error?.(MISSING_EXE_HELP);
      return;
    }

    try {
      bridgeFiber = ctx.plugin(mcpClient, {
        transport: "stdio",
        serverName: "ghostscreen",
        command: mounted.exe,
        args: cfg.args,
        env: cfg.env,
        toolCallTimeoutMs: cfg.toolCallTimeoutMs,
        failOnStartupError: false,
        reconnect: {
          enabled: true,
          initialDelayMs: 500,
          maxDelayMs: 30000,
          maxAttempts: 10,
        },
      });
      state.current = { version: mounted.version?.raw ?? null, exe: mounted.exe, source: mounted.source };
      log(ctx, `[dsh-ghostscreen-mcp] bridge mounted: ${mounted.exe} (${mounted.source}${mounted.version ? ` ${mounted.version.raw}` : ""})`);
    } catch (error) {
      ctx.logger?.error?.("[dsh-ghostscreen-mcp] mount failed:", error);
      return;
    }

    if (paths) {
      // Newest first: whatever runs now stays, every older managed copy goes.
      const keep = bestInVersions(paths.versions);
      // The updater owns app\versions: inspect the package it will run next,
      // even while a pinned developer build is what is actually mounted.
      state.integrity = keep ? inspectPackage(keep.dir) : null;
      reportIntegrity(ctx, state.integrity);
      cleanupVersions(ctx, paths, keep?.dir);
      // Every start checks online; a newer release downloads in the background
      // and takes over on the next start.
      void refresh("startup");
    }
  }

  await mountBridge(true);

  // Settings page saves land here (volatile commit, no fiber remount):
  // relaunch the bridge with the new exe / args / env / timeout.
  ctx.on("loader/volatile-update", (changed) => {
    const flat = (changed ?? []).map((p) => (Array.isArray(p) ? p.join(".") : String(p)));
    const relevant = flat.some(
      (p) =>
        p === "exePath" ||
        p === "command" ||
        p === "args" ||
        p.startsWith("args.") ||
        p === "env" ||
        p.startsWith("env.") ||
        p === "toolCallTimeoutMs",
    );
    if (!relevant) return;
    log(ctx, `[dsh-ghostscreen-mcp] config changed (${flat.join(", ")}); remounting bridge`);
    const old = bridgeFiber;
    bridgeFiber = null;
    generation++;
    const remount = () => void mountBridge(true);
    if (old) Promise.resolve(old.dispose()).then(remount, remount).catch(() => {});
    else remount();
  });

  // We ship our own plugin page; opt out of the auto-generated settings page.
  ctx.inject(["settings"], (sctx) => {
    ctx.effect(
      () => sctx.settings.configure({ auto: false }, ctx.fiber),
      "ghostscreen-mcp: disable auto settings page",
    );
  });
}
