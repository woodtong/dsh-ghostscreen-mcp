#!/usr/bin/env node
// Self-check for dsh-ghostscreen-mcp.
//
// Release mode (default) is deliberately independent of this working tree: it
// downloads the version-agnostic Release asset that users actually get, unpacks
// it into a temp dir, validates the package contract against the market's
// rules, then imports that unpacked copy and runs apply() against an empty
// %LOCALAPPDATA% to prove the install path works on a machine with no local DSH
// configuration and no GhostScreen install.
//
// --local stages the working tree the way `npm pack` would (the package.json
// "files" whitelist) and runs the same package + runtime checks on it. That is
// the gate to run before every release.
//
// Nothing under the user's real %LOCALAPPDATA%\GhostScreen is read or written,
// and the server exe is never launched: the bridge is a recording stand-in, and
// every "GitHub" in the behaviour checks is an in-process fake.
//
// Usage:
//   node tools/selfcheck.mjs              # the published Release, incl. a ~200 MB download
//   node tools/selfcheck.mjs --local      # the working tree (run before every release)
//   node tools/selfcheck.mjs --offline    # skip the live download / market probes
//   node tools/selfcheck.mjs --tag v0.2.3 # a specific tag's asset
//
// Exit code 0 = every check passed, 1 = at least one failed, 2 = bad arguments.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const REPO = "woodtong/dsh-ghostscreen-mcp";
const ASSET = "dsh-ghostscreen-mcp.tgz";
const ENTRY_URL = "https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/data/plugins/woodtong__dsh-ghostscreen-mcp.yml";
const CATALOG_URL = "https://awesome-dsh-plugin.com/plugins.json";
const CATEGORIES = new Set(["agi", "ui", "usage", "theme", "model", "identity", "session", "memory", "tools", "wsl",
  "browser", "vision", "voice", "docs", "skill", "workflow", "git", "notify", "dev", "security", "remote", "market", "fun"]);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const argv = process.argv.slice(2);
const argOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const requestedTag = argOf("--tag");
const local = argv.includes("--local");
const offline = argv.includes("--offline");
if (local && requestedTag) {
  console.error("--local checks the working tree; --tag checks a Release. Use one or the other.");
  process.exit(2);
}

const results = [];
const skipped = [];
// A failed acquisition makes every later check meaningless, so they are skipped
// with the real reason instead of reporting a screen of misleading failures.
const deps = { pkg: false, reason: "the package was never acquired" };

async function check(name, fn, { needs, acquire } = {}) {
  if (needs && !deps[needs]) { skip(name, `not run: ${deps.reason}`); return false; }
  const started = Date.now();
  const ctxMark = ctxs.length;
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: typeof detail === "string" ? detail : "", ms: Date.now() - started });
    return true;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    results.push({ name, ok: false, detail: message, ms: Date.now() - started });
    if (acquire) { deps.pkg = false; deps.reason = `${name}: ${message}`; }
    return false;
  } finally {
    // Whatever plugin instances the check started are disabled here, so a
    // pending retry timer or download never leaks into the next check.
    for (const c of ctxs.splice(ctxMark)) await c.dispose();
  }
}
function skip(name, why) { skipped.push({ name, why }); }
function expect(cond, msg) { if (!cond) throw new Error(msg); return true; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, predicate, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try { last = await predicate(); if (last) return last; } catch (err) { last = err; }
    await sleep(100);
  }
  throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${what}${last instanceof Error ? `: ${last.message}` : ""}`);
}

/* ----------------------------------------------------------------------- */
/* Network helpers (node fetch first, curl.exe through the proxy second)    */
/* ----------------------------------------------------------------------- */

const realFetch = globalThis.fetch;

function curlText(args, timeoutMs = 320_000) {
  const r = spawnSync("curl.exe", ["-sSL", "--fail", "--connect-timeout", "20", "--max-time", "300", ...args], {
    timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  });
  if (r.status !== 0) {
    const line = String(r.stderr || "").trim().split(/\r?\n/).filter(Boolean).pop();
    throw new Error(`curl exit ${r.status}${line ? `: ${line}` : ""}${r.error ? ` (${r.error.message})` : ""}`);
  }
  return r.stdout;
}

// An answer the server will give the same way however often we ask (a 404, a
// 403 rate limit by IP): reported at once instead of after minutes of retries.
class FinalAnswer extends Error {}

async function getBytes(url, { tries = 5 } = {}) {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await realFetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
      if (res.status === 200) return Buffer.from(await res.arrayBuffer());
      const clientError = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
      throw (clientError ? new FinalAnswer(`HTTP ${res.status}`) : new Error(`HTTP ${res.status}`));
    } catch (err) {
      if (err instanceof FinalAnswer) throw new Error(`${err.message} from ${url}`);
      last = `node fetch: ${err.message}`;
    }
    try {
      const out = curlText(["--output", "-", url]);
      if (out.length) return out;
      last = "curl: empty body";
    } catch (err) { last = `${last}; ${err.message}`; }
    if (i < tries - 1) {
      console.log(`      retry ${i + 1}/${tries - 1} in ${3 * (i + 1)} s  (${last.slice(0, 200)})`);
      await sleep(3000 * (i + 1));
    }
  }
  throw new Error(`GET failed after ${tries} attempts: ${last}`);
}
const getText = async (url, opts) => (await getBytes(url, opts)).toString("utf8");

function sha256(buf) { return createHash("sha256").update(buf).digest("hex").toUpperCase(); }

// The newest release tag, read from where https://github.com/<repo>/releases/latest
// redirects. Deliberately not the REST API: unauthenticated api.github.com
// answers 403 (rate limit) from many networks — the plugin has the same fallback.
async function latestTag(repo = REPO) {
  if (requestedTag && repo === REPO) return requestedTag;
  let loc = "";
  try {
    loc = (await realFetch(`https://github.com/${repo}/releases/latest`, { redirect: "manual", signal: AbortSignal.timeout(30_000) })).headers.get("location") || "";
  } catch { /* fall through to curl */ }
  if (!loc) loc = (/^location:\s*(\S+)/im.exec(curlText(["--head", `https://github.com/${repo}/releases/latest`], 60_000)) || [])[1] || "";
  const m = loc.match(/\/tag\/(v[^/?#]+)/);
  if (!m) throw new Error(`could not read the latest tag from the redirect (${loc || "no Location header"})`);
  return m[1];
}

async function httpOk(url) {
  try {
    const code = (await realFetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(30_000) })).status;
    if (code === 200) return true;
  } catch { /* fall through to curl */ }
  return String(curlText(["--head", "--output", "NUL", "--write-out", "%{http_code}", url], 60_000)).trim() === "200";
}

// A stand-in for the DSH schemastery build, enough for the module-level Config
// schema: Schema.object/string/array/dict/number plus a chainable volatile().
const SCHEMA_STUB = `const chain = () => {
  const fn = () => chain();
  fn.volatile = () => chain();
  fn.default = () => chain();
  fn.description = () => chain();
  fn.required = () => chain();
  return fn;
};
const Schema = (...a) => chain();
for (const k of ["object", "string", "array", "dict", "number", "boolean", "union", "const"]) Schema[k] = (...a) => chain();
export default Schema;
`;

// Minimal stand-in for the Cordis context the plugin is applied to: service
// injection, effect scopes, event bus, the status route and the plugin mount.
// A mounted bridge is only recorded, never started.
const ctxs = []; // every context made so far; check() disposes the ones a check created
function makeCtx() {
  const logs = { info: [], warn: [], error: [] };
  const mounts = [];
  const routes = new Map();
  const handlers = new Map();
  const settings = [];
  const disposers = [];
  const services = {
    webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path); } },
    settings: { configure: (opts) => settings.push(opts) },
  };
  const line = (...a) => a.map((x) => (x instanceof Error ? x.message : String(x))).join(" ");
  const ctx = {
    logger: {
      info: (...a) => logs.info.push(line(...a)),
      warn: (...a) => logs.warn.push(line(...a)),
      error: (...a) => logs.error.push(line(...a)),
    },
    plugin: (_client, opts) => {
      const fiber = { opts, disposed: false, dispose: () => { fiber.disposed = true; return Promise.resolve(); } };
      mounts.push(fiber);
      return fiber;
    },
    inject: (deps, cb) => cb(Object.fromEntries(deps.map((d) => [d, services[d]]))),
    effect: (fn) => { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); return dispose; },
    on: (event, cb) => handlers.set(event, cb),
  };
  // Disabling the plugin runs its effect disposers and, as in Cordis, takes
  // the child bridge down with it.
  const dispose = async () => {
    for (const d of disposers.splice(0)) d();
    for (const f of mounts.splice(0)) await f.dispose();
  };
  ctx.fiber = { dispose };
  ctxs.push({ dispose });
  const status = async () => {
    const res = await routes.get("/ghostscreen-mcp/status").resource({ url: "/ghostscreen-mcp/status" });
    return JSON.parse(await res.text());
  };
  const poke = () => routes.get("/ghostscreen-mcp/status").resource({ url: "/ghostscreen-mcp/status?refresh=1" });
  const live = () => mounts.filter((f) => !f.disposed);
  const allLogs = () => [...logs.info, ...logs.warn, ...logs.error].join("\n");
  return { ctx, mounts, logs, routes, handlers, settings, status, poke, live, allLogs };
}

const work = mkdtempSync(join(tmpdir(), "gs-selfcheck-"));
const tempDirs = [work];
process.on("exit", () => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
});

let pkgDir, pkgJson, tag, tgz, documentedTools;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/* ----------------------------------------------------------------------- */
/* 1. The package: the published tarball, or the working tree with --local  */
/* ----------------------------------------------------------------------- */

if (local) {
  await check("working tree stages like npm pack would (files whitelist)", async () => {
    const raw = readFileSync(join(ROOT, "package.json"));
    pkgJson = JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, ""));
    const list = (pkgJson.files || []).map((f) => String(f).replace(/^\.\//, "").replace(/\/$/, ""));
    expect(list.length > 0, "files whitelist missing");
    pkgDir = join(work, "pkg", "package");
    mkdirSync(pkgDir, { recursive: true });
    for (const entry of list) {
      const src = join(ROOT, entry);
      if (existsSync(src)) cpSync(src, join(pkgDir, entry), { recursive: true });
    }
    cpSync(join(ROOT, "package.json"), join(pkgDir, "package.json"));
    deps.pkg = true;
    return `${list.length} whitelist entries staged from ${ROOT}`;
  }, { acquire: true });
} else {
  await check("Release resolves to a version-agnostic asset", async () => {
    tag = await latestTag();
    const url = requestedTag
      ? `https://github.com/${REPO}/releases/download/${tag}/${ASSET}`
      : `https://github.com/${REPO}/releases/latest/download/${ASSET}`;
    expect(await httpOk(url), `${url} does not answer 200`);
    return `${tag} / ${ASSET}`;
  }, { acquire: true });

  await check("asset downloads intact", async () => {
    const url = requestedTag
      ? `https://github.com/${REPO}/releases/download/${tag}/${ASSET}`
      : `https://github.com/${REPO}/releases/latest/download/${ASSET}`;
    tgz = await getBytes(url);
    writeFileSync(join(work, ASSET), tgz);
    return `${tgz.length} bytes, sha256 ${sha256(tgz)}`;
  }, { acquire: true });

  await check("tarball unpacks with the documented layout", async () => {
    const out = join(work, "pkg");
    mkdirSync(out, { recursive: true });
    const r = spawnSync("tar", ["-xzf", join(work, ASSET), "-C", out], { encoding: "utf8" });
    expect(r.status === 0, `tar failed: ${r.stderr || r.status}`);
    pkgDir = join(out, "package");
    expect(existsSync(join(pkgDir, "package.json")), "package/package.json missing");
    expect(existsSync(join(pkgDir, "index.mjs")), "package/index.mjs missing");
    deps.pkg = true;
    return "package/ with package.json + index.mjs";
  }, { acquire: true });
}

const needsPkg = { needs: "pkg" };

await check("every shipped text file is BOM-free strict UTF-8", async () => {
  const offenders = [];
  for (const file of walk(pkgDir)) {
    if (!/\.(json|mjs|js|yml|yaml|md|svg)$/i.test(file)) continue;
    const b = readFileSync(file).subarray(0, 3);
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) offenders.push(relative(pkgDir, file));
  }
  expect(offenders.length === 0, `UTF-8 BOM found in: ${offenders.join(", ")}`);
  // DSH reads package.json byte-for-byte: require() hides a BOM, this does not.
  pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  expect(pkgJson.name === "dsh-ghostscreen-mcp", `unexpected name ${pkgJson.name}`);
  return `no BOM; package.json parses, version ${pkgJson.version}`;
}, needsPkg);

if (local) {
  skip("version lines up with the Release tag", "--local: the tag v<version> is created after this gate passes (PUBLISHING.md step 2)");
} else {
  await check("version lines up with the Release tag", async () => {
    const v = String(pkgJson.version || "");
    expect(/^\d+\.\d+\.\d+/.test(v), `unparseable version ${v}`);
    expect(tag === `v${v}`, `tag ${tag} does not match package version ${v}`);
    return `${tag} == v${v}`;
  }, needsPkg);
}

await check("dsh.bundle manifest points at a shipped patch file", async () => {
  const patch = pkgJson.dsh && pkgJson.dsh.bundle && pkgJson.dsh.bundle.patch;
  expect(patch, "dsh.bundle.patch missing (DSH would not recognise the package as a bundle)");
  const rel = String(patch).replace(/^\.\//, "");
  expect(existsSync(join(pkgDir, rel)), `${rel} not in the package`);
  const body = readFileSync(join(pkgDir, rel), "utf8");
  expect(/id:\s*ghostscreen-mcp-runtime/.test(body), "patch is missing id ghostscreen-mcp-runtime");
  expect(/name:\s*dsh-ghostscreen-mcp/.test(body), "patch is missing name dsh-ghostscreen-mcp");
  return `dsh.bundle.patch=${patch}`;
}, needsPkg);

await check("package.json has no install-time scripts", async () => {
  const hooks = Object.keys(pkgJson.scripts || {}).filter((k) => /^(pre|post)?(install|prepare|prepack|postpack)$/.test(k));
  expect(hooks.length === 0, `install-time hooks present: ${hooks.join(", ")}`);
  return "no install/prepare hooks";
}, needsPkg);

await check("files whitelist is complete inside the package", async () => {
  const missing = (pkgJson.files || []).filter((f) => !existsSync(join(pkgDir, String(f).replace(/^\.\//, ""))));
  expect((pkgJson.files || []).length > 0, "files whitelist missing");
  expect(missing.length === 0, `listed but absent: ${missing.join(", ")}`);
  return `${pkgJson.files.length} entries present`;
}, needsPkg);

await check("nothing outside the files whitelist is shipped", async () => {
  const always = /^(package\.json|README(\.[^/]*)?|LICENSE(\.[^/]*)?|CHANGELOG(\.[^/]*)?)$/i;
  const listed = (pkgJson.files || []).map((f) => String(f).replace(/^\.\//, "").replace(/\/$/, ""));
  const files = walk(pkgDir).map((f) => relative(pkgDir, f).split(sep).join("/"));
  const stray = files.filter((rel) =>
    rel !== (pkgJson.main || "index.mjs") && !always.test(rel) && !listed.some((f) => rel === f || rel.startsWith(`${f}/`)));
  expect(stray.length === 0, `shipped but not whitelisted: ${stray.join(", ")}`);
  return `${files.length} files, all whitelisted (or npm's always-included set)`;
}, needsPkg);

await check("every peer range carries an explicit prerelease branch", async () => {
  const peers = pkgJson.peerDependencies || {};
  expect(Object.keys(peers).length > 0, "no peerDependencies");
  const bad = Object.entries(peers)
    .filter(([, range]) => String(range).split("||").some((part) => !/-\d|-(rc|beta|alpha)/i.test(part)));
  expect(bad.length === 0, `range without a prerelease branch: ${bad.map(([k, v]) => `${k}@${v}`).join(", ")}`);
  return Object.entries(peers).map(([k, v]) => `${k}@${v}`).join(", ");
}, needsPkg);

await check("documented tool count is consistent across the docs", async () => {
  const readme = readFileSync(join(pkgDir, "README.md"), "utf8");
  const readmeZh = readFileSync(join(pkgDir, "README.zh.md"), "utf8");
  const en = (/\b(\d+)\s+tools\b/i.exec(readme) || [])[1];
  const zh = (/(\d+)\s*个/i.exec(readmeZh) || [])[1];
  expect(en && zh, `README.md says "${en}" tools, README.zh.md says "${zh}"`);
  expect(en === zh, `README.md says ${en} tools, README.zh.md says ${zh}`);
  documentedTools = Number(en);
  return `README.md / README.zh.md agree on ${documentedTools}`;
}, needsPkg);

/* ----------------------------------------------------------------------- */
/* 2. The market listing                                                   */
/* ----------------------------------------------------------------------- */

if (local || offline) {
  const why = local ? "--local: nothing is published from the working tree" : "--offline";
  skip("market entry is live and self-consistent", why);
  skip("market catalog lists the plugin", why);
  skip("market tarball URL serves this release", why);
} else {
  await check("market entry is live and self-consistent", async () => {
    const entry = await getText(ENTRY_URL);
    expect(entry.includes(`url: https://github.com/${REPO}`), "entry url does not point at this repo");
    const cat = (entry.match(/^category:\s*(\S+)/m) || [])[1];
    expect(cat && CATEGORIES.has(cat), `category invalid: ${cat}`);
    const tarball = (entry.match(/^tarball:\s*(\S+)/m) || [])[1];
    expect(tarball === `https://github.com/${REPO}/releases/latest/download/${ASSET}`, `tarball must be the version-agnostic latest URL, got ${tarball}`);
    expect(entry.includes(String(documentedTools)), `entry description does not state ${documentedTools} tools`);
    return `category ${cat}, version-agnostic tarball, ${documentedTools} tools`;
  });

  await check("market catalog lists the plugin", async () => {
    const body = await getText(CATALOG_URL);
    expect(body.toLowerCase().includes("dsh-ghostscreen-mcp"), "not present in plugins.json");
    return "found in awesome-dsh-plugin.com/plugins.json";
  });

  if (requestedTag) skip("market tarball URL serves this release", `--tag ${requestedTag} (latest may differ)`);
  else await check("market tarball URL serves this release", async () => {
    const buf = await getBytes(`https://github.com/${REPO}/releases/latest/download/${ASSET}`);
    expect(sha256(buf) === sha256(tgz), "market URL serves a different file than the checked asset");
    return "identical sha256";
  });
}

/* ----------------------------------------------------------------------- */
/* 3. Package contract + runtime on a clean profile                        */
/* ----------------------------------------------------------------------- */

await check("plugin loads with its peer dependencies resolvable", async () => {
  const depsDir = join(pkgDir, "node_modules", "@deepseek-ai");
  mkdirSync(depsDir, { recursive: true });
  // The package ships no dependencies (they are peers, provided by DSH). Link
  // the bridge from this checkout when present, else a harmless stand-in.
  const bridge = join(ROOT, "node_modules", "@deepseek-ai", "dsh-mcp-client");
  const bridgeDir = join(depsDir, "dsh-mcp-client");
  if (existsSync(bridge)) {
    try { symlinkSync(bridge, bridgeDir, "junction"); } catch { /* already linked */ }
  } else {
    mkdirSync(bridgeDir, { recursive: true });
    writeFileSync(join(bridgeDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh-mcp-client", type: "module", main: "index.mjs" }));
    writeFileSync(join(bridgeDir, "index.mjs"), "export default {};\nexport {};\n");
  }
  mkdirSync(join(depsDir, "schemastery"), { recursive: true });
  writeFileSync(join(depsDir, "schemastery", "package.json"), JSON.stringify({ name: "@deepseek-ai/schemastery", type: "module", main: "index.mjs" }));
  writeFileSync(join(depsDir, "schemastery", "index.mjs"), SCHEMA_STUB);
  const mod = await import(pathToFileURL(join(pkgDir, "index.mjs")).href);
  expect(mod.name === "dsh-ghostscreen-mcp", `export name ${mod.name}`);
  expect(typeof mod.apply === "function", "apply() not exported");
  expect(Array.isArray(mod.inject) && mod.inject.includes("tools"), "inject does not include tools");
  return "name + inject(tools) + apply exported";
}, needsPkg);

function cleanProfile() {
  const dir = mkdtempSync(join(tmpdir(), "gs-selfcheck-local-"));
  tempDirs.push(dir);
  process.env.LOCALAPPDATA = dir;
  delete process.env.GHOSTSCREEN_MCP_EXE;
  return dir;
}

// The updater uses fetch and falls back to curl.exe. For the behaviour checks
// fetch is an in-process fake and the proxies point at a closed port, so curl
// fails instantly and nothing reaches the real network.
const savedEnv = {};
function quarantineNetwork() {
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NO_PROXY", "no_proxy"]) savedEnv[k] = process.env[k];
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) process.env[k] = "http://127.0.0.1:9";
  process.env.NO_PROXY = process.env.no_proxy = "";
}
function restoreNetwork() { Object.assign(process.env, savedEnv); globalThis.fetch = realFetch; }

const FAKE_ORIGIN = "https://fake-github.invalid";
const assetName = (t) => `GhostScreen-${t.replace(/^v/, "")}-win-x64.zip`;

/** A release zip with the layout the updater requires, built with the system tar. */
function buildZip(dir, version) {
  mkdirSync(dir, { recursive: true });
  const entries = {
    "mcp/GhostScreen.Mcp.exe": "stub",
    "cli/GhostScreen.Cli.exe": "stub",
    "GhostScreen.Notifier/GhostScreen.Notifier.exe": "stub",
    VERSION: version,
  };
  for (const [rel, body] of Object.entries(entries)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  const zip = `${dir}.zip`;
  const r = spawnSync("tar", ["-a", "-cf", zip, "-C", dir, ...Object.keys(entries)], { encoding: "utf8" });
  expect(r.status === 0, `tar could not build the fixture zip: ${r.stderr || r.status}`);
  tempDirs.push(zip);
  return readFileSync(zip);
}

/** Programmable GitHub: `releases` are served while `down` is false, nothing otherwise. */
function fakeGithub(net) {
  return async (url) => {
    net.calls.push(String(url));
    if (net.down) throw new TypeError("fetch failed (fake offline)");
    const u = new URL(url);
    if (u.hostname === "api.github.com") {
      const body = net.releases.map((r) => ({
        tag_name: r.tag,
        draft: false,
        assets: [{ name: assetName(r.tag), size: r.zip.length, digest: `sha256:${sha256(r.zip).toLowerCase()}`, browser_download_url: `${FAKE_ORIGIN}/dl/${assetName(r.tag)}` }],
      }));
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    const hit = net.releases.find((r) => r.url === u.href);
    return hit ? new Response(hit.zip, { status: 200, headers: { "content-length": String(hit.zip.length) } }) : new Response("not found", { status: 404 });
  };
}

let seq = 0;
async function freshPlugin(net) {
  globalThis.fetch = fakeGithub(net);
  return import(pathToFileURL(join(pkgDir, "index.mjs")).href + `?case=${++seq}`);
}
const managedExe = (local_, v) => join(local_, "GhostScreen", "app", "versions", v, "mcp", "GhostScreen.Mcp.exe");
const seedManaged = (local_, v) => {
  mkdirSync(dirname(managedExe(local_, v)), { recursive: true });
  writeFileSync(managedExe(local_, v), "stub");
  writeFileSync(join(local_, "GhostScreen", "app", "versions", v, "VERSION"), v);
};

// The plugin's retry schedule is 10 s / 30 s / 2 min / 10 min; map exactly
// those delays onto a quarter second so the checks stay fast and deterministic.
const RETRY_DELAYS_MS = [10_000, 30_000, 120_000, 600_000];
const realSetTimeout = globalThis.setTimeout;
function shortenRetries(on) {
  globalThis.setTimeout = on
    ? (fn, ms, ...rest) => (RETRY_DELAYS_MS.includes(ms) ? realSetTimeout(fn, 250, ...rest) : realSetTimeout(fn, ms, ...rest))
    : realSetTimeout;
}

quarantineNetwork();
shortenRetries(true);

await check("clean profile, GitHub unreachable: no mount, guidance, a retry is scheduled", async () => {
  const dir = cleanProfile();
  const net = { down: true, releases: [], calls: [] };
  const h = makeCtx();
  const mod = await freshPlugin(net);
  await mod.apply(h.ctx, {});
  expect(h.mounts.length === 0, "mounted a bridge without a server package");
  const guidance = h.logs.error.join("\n");
  expect(/GhostScreen\.Mcp\.exe is unavailable/.test(guidance), "no missing-exe guidance logged");
  expect(/releases/i.test(guidance), "guidance does not point at the Release page");
  expect(h.routes.size === 1, "update status route was not registered");
  const s = await h.status();
  expect(s.phase === "error" && s.error && s.error.message, `status should report the failed download, got phase ${s.phase}`);
  expect(Number.isFinite(s.retryAt) && s.retryAt > Date.now(), "no automatic retry is scheduled (retryAt)");
  expect(!existsSync(join(dir, "GhostScreen", "app", "versions")), "a failed download must not leave a versions dir behind");
  return "session boots without the tools, says why, retries on its own";
}, needsPkg);

// Here the background retry keeps its real 10 s distance, so this check is
// about the button alone; the background path has its own check below.
shortenRetries(false);
try {
  await check("after the network recovers, \"Check now\" installs AND mounts at once", async () => {
    const dir = cleanProfile();
    const net = { down: true, releases: [{ tag: "v0.2.0", zip: buildZip(join(work, "rel-0.2.0-a"), "0.2.0") }], calls: [] };
    net.releases.forEach((r) => { r.url = `${FAKE_ORIGIN}/dl/${assetName(r.tag)}`; });
    const h = makeCtx();
    const mod = await freshPlugin(net);
    await mod.apply(h.ctx, {});
    expect(h.mounts.length === 0, "precondition: nothing mounted while offline");
    net.down = false;
    await h.poke();
    await waitFor("the mount", async () => (h.mounts.length === 1 && (await h.status()).phase === "idle"));
    expect(h.mounts.length === 1, `expected exactly one mount, got ${h.mounts.length}`);
    const exe = h.mounts[0].opts.command;
    expect(exe === managedExe(dir, "0.2.0"), `unexpected exe ${exe}`);
    expect(existsSync(exe), `mounted exe does not exist: ${exe}`);
    const s = await h.status();
    expect(s.current && s.current.source === "managed" && s.current.version === "0.2.0", `status does not show the running install: ${JSON.stringify(s.current)}`);
    expect(s.retryAt === null, "a retry is still scheduled after the mount");
    expect(/mounting it now/.test(h.allLogs()), "log does not say the install is mounted right away");
    expect(!/restart DSH to activate/.test(h.allLogs()), "log still asks for a restart although nothing was running");
    expect(!/retrying the first download/.test(h.allLogs()), "the background retry fired although it was 10 s away");
    return "one mount, no restart needed, status page shows it running";
  }, needsPkg);
} finally {
  shortenRetries(true);
}

await check("after the network recovers, the background retry heals by itself", async () => {
  const dir = cleanProfile();
  const net = { down: true, releases: [{ tag: "v0.2.0", zip: buildZip(join(work, "rel-0.2.0-b"), "0.2.0") }], calls: [] };
  net.releases.forEach((r) => { r.url = `${FAKE_ORIGIN}/dl/${assetName(r.tag)}`; });
  const h = makeCtx();
  const mod = await freshPlugin(net);
  await mod.apply(h.ctx, {});
  net.down = false; // the proxy starts working again; nobody touches the page
  await waitFor("the self-healed mount", async () => (h.live().length === 1 && (await h.status()).phase === "idle"));
  expect(h.mounts.length === 1, `expected exactly one mount, got ${h.mounts.length}`);
  expect(h.mounts[0].opts.command === managedExe(dir, "0.2.0"), `unexpected exe ${h.mounts[0].opts.command}`);
  expect(/retrying the first download \(1\/4\)/.test(h.allLogs()), "the retry is not announced in the log");
  expect((await h.status()).retryAt === null, "a retry is still scheduled after the mount");
  return "mounted without any user action";
}, needsPkg);

await check("while GitHub stays unreachable the retries are bounded, then it stops", async () => {
  cleanProfile();
  const net = { down: true, releases: [], calls: [] };
  const h = makeCtx();
  const mod = await freshPlugin(net);
  await mod.apply(h.ctx, {});
  await waitFor("the final give-up line", () => /still no server package/.test(h.allLogs()), 30000);
  const attempts = h.allLogs().match(/retrying the first download \(\d\/4\)/g) || [];
  expect(attempts.length === RETRY_DELAYS_MS.length, `expected ${RETRY_DELAYS_MS.length} retries, saw ${attempts.length}`);
  await sleep(600);
  expect(h.mounts.length === 0, "mounted a bridge without a server package");
  const s = await h.status();
  expect(s.retryAt === null, "a retry is still scheduled after giving up");
  expect(net.calls.length > 0, "the fake GitHub was never asked");
  return `${RETRY_DELAYS_MS.length} retries (10 s, 30 s, 2 min, 10 min), then a hint to press Retry`;
}, needsPkg);

await check("disabling the plugin cancels the pending retry", async () => {
  cleanProfile();
  const net = { down: true, releases: [], calls: [] };
  const h = makeCtx();
  const mod = await freshPlugin(net);
  await mod.apply(h.ctx, {});
  expect(Number.isFinite((await h.status()).retryAt), "precondition: a retry is pending");
  await h.ctx.fiber.dispose();
  await sleep(700);
  expect(!/retrying the first download/.test(h.allLogs()), "the retry fired after the plugin was disposed");
  expect(h.mounts.length === 0, "a disposed plugin mounted a bridge");
  return "no retry, no mount after dispose";
}, needsPkg);

await check("offline: mounts the newest managed version over legacy layouts", async () => {
  const dir = cleanProfile();
  const app = join(dir, "GhostScreen", "app");
  mkdirSync(join(app, "mcp"), { recursive: true });
  writeFileSync(join(app, "mcp", "GhostScreen.Mcp.exe"), "stub");
  writeFileSync(join(app, "VERSION"), "0.9.9");
  for (const v of ["0.0.1", "0.0.9", "0.0.5"]) seedManaged(dir, v);
  const h = makeCtx();
  const mod = await freshPlugin({ down: true, releases: [], calls: [] });
  await mod.apply(h.ctx, {});
  expect(h.mounts.length === 1, `expected exactly one mount, got ${h.mounts.length}`);
  const m = h.mounts[0].opts;
  expect(m.transport === "stdio", `transport ${m.transport}`);
  expect(m.serverName === "ghostscreen", `serverName ${m.serverName} (tools are named mcp__<serverName>__*)`);
  expect(m.command === managedExe(dir, "0.0.9"), `did not pick the newest version: ${m.command}`);
  expect(m.failOnStartupError === false, "failOnStartupError must be false (a dead server must not kill the session)");
  expect(m.reconnect && m.reconnect.enabled === true, "reconnect not enabled");
  return "stdio / ghostscreen / newest of {0.0.1,0.0.5,0.0.9} / reconnect on";
}, needsPkg);

await check("offline: config.exePath overrides the managed install", async () => {
  const dir = cleanProfile();
  mkdirSync(join(dir, "GhostScreen", "app", "mcp"), { recursive: true });
  const pinned = join(dir, "dev-build.exe");
  writeFileSync(pinned, "stub");
  const h = makeCtx();
  const mod = await freshPlugin({ down: true, releases: [], calls: [] });
  await mod.apply(h.ctx, { exePath: pinned });
  expect(h.mounts.length === 1 && h.mounts[0].opts.command === pinned, `exePath ignored: ${h.mounts[0] && h.mounts[0].opts.command}`);
  return "developer pin still works";
}, needsPkg);

await check("a newer release found at start downloads without disturbing the running bridge", async () => {
  const dir = cleanProfile();
  seedManaged(dir, "0.1.0");
  const net = { down: false, releases: [{ tag: "v0.2.0", zip: buildZip(join(work, "rel-0.2.0-c"), "0.2.0") }], calls: [] };
  net.releases.forEach((r) => { r.url = `${FAKE_ORIGIN}/dl/${assetName(r.tag)}`; });
  const h = makeCtx();
  const mod = await freshPlugin(net);
  await mod.apply(h.ctx, {});
  expect(h.mounts.length === 1 && h.mounts[0].opts.command === managedExe(dir, "0.1.0"), "the installed version was not mounted first");
  await waitFor("the pending update", async () => (await h.status()).phase === "ready", 30000);
  await sleep(300);
  expect(h.mounts.length === 1, `a running bridge must not be swapped behind the session's back, saw ${h.mounts.length} mounts`);
  const s = await h.status();
  expect(s.managed[0] && s.managed[0].version === "0.2.0", "the new release is not in the managed folder");
  expect(/restart DSH to activate it/.test(h.allLogs()), "the log does not say the new version starts on the next start");
  expect(existsSync(managedExe(dir, "0.1.0")), "the running version was deleted from under the bridge");
  return "v0.1.0 keeps running, v0.2.0 waits for the next start";
}, needsPkg);

await check("a settings save remounts once per save and never leaks a server", async () => {
  const dir = cleanProfile();
  seedManaged(dir, "0.1.0");
  const net = { down: false, releases: [{ tag: "v0.2.0", zip: buildZip(join(work, "rel-0.2.0-d"), "0.2.0") }], calls: [] };
  net.releases.forEach((r) => { r.url = `${FAKE_ORIGIN}/dl/${assetName(r.tag)}`; });
  const h = makeCtx();
  const mod = await freshPlugin(net);
  await mod.apply(h.ctx, { toolCallTimeoutMs: 12345 });
  expect(h.settings.length === 1 && h.settings[0].auto === false, "auto-generated settings page not disabled (the plugin ships its own)");
  const onVolatile = h.handlers.get("loader/volatile-update");
  expect(typeof onVolatile === "function", "no loader/volatile-update listener");
  await waitFor("the pending update", async () => (await h.status()).phase === "ready", 30000);

  // Two saves inside one tick, while the first remount is still disposing.
  onVolatile([["args"]]);
  onVolatile([["toolCallTimeoutMs"]]);
  const settled = () => h.mounts.length >= 3 && h.live().length === 1 && h.mounts.slice(0, -1).every((f) => f.disposed) && !h.mounts.at(-1).disposed;
  await waitFor("the serialised remounts", settled);
  await sleep(400);
  expect(settled(), `leaked or missing bridge: ${h.mounts.length} mounts, ${h.live().length} live`);
  expect(h.mounts.at(-1).opts.command === managedExe(dir, "0.2.0"), `a remount must run the newest install, got ${h.mounts.at(-1).opts.command}`);
  expect(h.mounts.every((f) => f.opts.toolCallTimeoutMs === 12345), "a remounted bridge lost the configured toolCallTimeoutMs");

  onVolatile([["exePath"]]);
  await waitFor("the third remount", () => h.mounts.length === 4 && h.live().length === 1 && h.mounts[2].disposed);
  return "4 mounts over 3 saves, exactly 1 live; the remount picks the pending version";
}, needsPkg);

restoreNetwork();
shortenRetries(false);

/* ----------------------------------------------------------------------- */
/* 4. The promise the README makes: no exe -> download -> mount            */
/* ----------------------------------------------------------------------- */

if (offline) {
  skip("clean profile, online: downloads the newest GhostScreen release and mounts it", "--offline");
} else {
  await check("clean profile, online: downloads the newest GhostScreen release and mounts it", async () => {
    const dir = cleanProfile();
    const h = makeCtx();
    const mod = await import(pathToFileURL(join(pkgDir, "index.mjs")).href + `?case=${++seq}`);
    await mod.apply(h.ctx, {});
    expect(h.mounts.length === 1, `expected one mount after bootstrap, got ${h.mounts.length}\n${h.logs.warn.join("\n")}`);
    const exe = h.mounts[0].opts.command;
    expect(exe.startsWith(join(dir, "GhostScreen", "app", "versions")), `not installed under the managed versions dir: ${exe}`);
    expect(existsSync(exe), `mounted exe does not exist: ${exe}`);
    const installed = readFileSync(join(exe, "..", "..", "VERSION"), "utf8").trim();
    const newest = await latestTag("woodtong/neutrino");
    expect(newest === `v${installed}`, `installed ${installed} but the newest published GhostScreen release is ${newest}`);
    expect(existsSync(join(exe, "..", "..", "GhostScreen.Notifier", "GhostScreen.Notifier.exe")), "package self-check: notifier missing");
    expect(existsSync(join(exe, "..", "..", "cli", "GhostScreen.Cli.exe")), "package self-check: cli missing");
    // Right after the mount the plugin starts its every-start update check, so
    // let that settle before reading the page: "ready" is the one phase that
    // asks for a restart, and the very first install must never show it.
    const settled = await waitFor("the startup update check to settle", async () => {
      const phase = (await h.status()).phase;
      return phase === "checking" || phase === "downloading" ? false : phase;
    });
    expect(settled !== "ready", `status page asks for a restart after the very first install (phase ${settled})`);
    return `GhostScreen ${installed} (newest release), package complete, phase ${settled}`;
  }, needsPkg);
}

// ---------------------------------------------------------------------------
const width = Math.max(12, ...results.map((r) => r.name.length), ...skipped.map((r) => r.name.length));
const failed = results.filter((r) => !r.ok);
console.log(`\ndsh-ghostscreen-mcp self-check — ${local ? `working tree ${ROOT}` : `Release ${requestedTag || "latest"}`} (${offline ? "offline" : "online"})`);
const secs = (r) => `${String(Math.round((r.ms ?? 0) / 100) / 10)}s`.padStart(6);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${secs(r)}  ${r.name.padEnd(width)}  ${r.detail}`);
for (const r of skipped) console.log(`SKIP         ${r.name.padEnd(width)}  ${r.why}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${skipped.length} skipped${failed.length ? " — self-check FAILED" : " — self-check OK"}`);
process.exit(failed.length ? 1 : 0);
