# dsh-ghostscreen-mcp

Mounts the [GhostScreen (Neutrino)](https://github.com/woodtong/neutrino) MCP
server into every [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(DSH) session, giving the agent an **invisible screen**: real windows are
parked off the virtual desktop, captured with PrintWindow, and driven with
window messages / UIA behind a human consent gate. Headless web pages run in a
private headless Edge driven over CDP.

All 25 tools the server exposes (GhostScreen 0.2.0) are registered as
`mcp__ghostscreen__<ToolName>`:

- Windows & visibility: `list_windows`, `attach_window`, `park_window`,
  `show_to_user`, `set_visibility`, `screenshot`, `observe`, `snapshot`
- Native input: `click`, `click_element`, `set_text`, `key`, `drag`, `scroll`,
  `close_target`
- Headless web: `open_web`, `attach_cdp`, `navigate`, `get_html`, `viewport`,
  `console`, `network`
- Lifecycle: `list_targets`, `close_all`, `end_turn`

An older server binary exposes fewer tools; the list above tracks the current
release.

Safety invariants: never steals focus, never moves the real cursor, never
touches the clipboard. When a human is actively using the desktop, UIA actions
first ask for consent through a non-activating prompt.

## Requirements

- Windows 10/11, DSH with the official MCP client bridge
  (`@deepseek-ai/dsh-mcp-client` >= 0.1.0-rc.6, bundled with DSH)
- The GhostScreen MCP server binary (`GhostScreen.Mcp.exe`), obtained from a
  Neutrino Release — see below. This plugin ships **no binary** and collects
  nothing.

## Install

```powershell
dsh plugin --profile <profile> add woodtong/dsh-ghostscreen-mcp
```

(or from npm when published: `dsh plugin add dsh-ghostscreen-mcp`)

### Getting GhostScreen.Mcp.exe

**Nothing to do.** On every DSH start the plugin asks GitHub for the newest
release; when it is newer than what is installed, it silently downloads
`GhostScreen-<version>-win-x64.zip` (~200 MiB, sha256-verified when the release
publishes one) and unpacks it into
`%LOCALAPPDATA%\GhostScreen\app\versions\<version>\`. The package carries both
halves of the product — the bridge (`mcp\`) and the desktop app (`cli\`,
`tray\`) — so one update covers everything.

The plugin page reports what is happening: checking, download percentage,
"downloaded — starts on the next DSH start", or the failure reason with a
**Check now** button. The next start mounts the new version and deletes the
older version folders (plus the download cache) to reclaim space. There is no
version picker: the plugin always runs the newest managed release, unless you
pin a local build (see below).

A **first** download is different: nothing is running yet, so the tools are
mounted the moment the package lands — no DSH restart. If that first download
fails (offline, restricted network, GitHub hiccup), the plugin logs guidance,
mounts nothing, keeps the rest of the DSH session working, and retries by
itself after 10 s, 30 s, 2 min and 10 min; the page shows the failure reason,
the time of the next attempt, and **Check now** retries immediately. The
retries stop after those four attempts — then the button or the next DSH
start is the way back.

Downloads survive interruptions: a transfer that stalls for 90 s is abandoned
and resumed from the byte it reached, switching between `curl` (honours
`HTTPS_PROXY`) and the built-in fetch as needed. The plugin never leaves a
half-written zip behind — it downloads to a temporary part file and only then
renames it into the cache.

### Managed vs. pinned: who runs what

The server binary comes from one of two places, and the choice is per machine —
never global:

| | Managed (default for every install) | Pinned (development only) |
|---|---|---|
| Where the exe comes from | Newest GitHub release, unpacked into `%LOCALAPPDATA%\GhostScreen\app\versions\<version>\` | The path in `config.exePath` or `%GHOSTSCREEN_MCP_EXE%` |
| Updates | Checked on every start, downloaded silently, mounted on the next start, older folders deleted | Auto-update keeps downloading, but never switches away from the pinned exe |
| Who runs it | Every machine whose profile has no pin | Only the machine that set the pin |

A pin lives in the **profile** (`~/.dsh/profiles/<profile>/cordis.patch.yml`),
written on that one machine. The plugin's own bundle patch ships no `config`
layer, so a fresh install always starts out managed. The intended split:

- **Development machine**: pin the local release build, so a rebuild takes
  effect on the next DSH start without publishing anything.
- **Everyone else**: no pin. They run the newest release you published, and get
  it automatically — publishing is the only step that changes what users run.

### Pinning a local build (development)

A locally built `GhostScreen.Mcp.exe` can still be pinned — just not from the
page. Either edit the plugin row's `config` in `cordis.patch.yml`:

```yaml
- id: ghostscreen-mcp-runtime
  name: dsh-ghostscreen-mcp
  config:
    exePath: 'D:\tools\GhostScreen\GhostScreen.Mcp.exe'
```

or set the `GHOSTSCREEN_MCP_EXE` environment variable. A pinned build always
wins over the managed versions (the page labels it "external build"); auto-update
keeps the managed folder current but never switches away from the pinned exe.

Resolution order: `exePath` → `GHOSTSCREEN_MCP_EXE` → newest managed version
under `versions\` → legacy layouts (`app\GhostScreen-<ver>\mcp\`, `app\mcp\`,
`app\GhostScreen.Mcp.exe`).

Remaining `config` keys: `args`, `env` (extra environment variables for the
server process), `toolCallTimeoutMs` (left to the bridge by default). The
download/update switches are gone — both are always on.

The page reads its status from a read-only host route,
`GET /ghostscreen-mcp/status` (same-origin JSON; `?refresh=1` forces a check).

### Package self-check

After an update (and on every start) the host looks inside the unpacked package
and, if something the plugin needs is missing, shows one warning line on the
page: `mcp\GhostScreen.Mcp.exe` always, plus
`GhostScreen.Notifier\GhostScreen.Notifier.exe` — that folder only ships from
GhostScreen **0.2.0** on, so releases older than that legitimately lack it and
the warning says so. The check is advisory: it never blocks the start, repairs
nothing, and leaves the download flow untouched.

## Verification

After installing and restarting DSH, the `mcp__ghostscreen__*` tools appear in
the session. Quick check: call `mcp__ghostscreen__list_windows` — it should
list your visible top-level windows.

## Development

`node tools/selfcheck.mjs --local` is the pre-release gate: it stages the
working tree exactly like `npm pack` would, then boots the plugin against a
fake GitHub to prove the first-download, retry and remount behaviour — without
touching the real `%LOCALAPPDATA%\GhostScreen` or starting a server process.
Without `--local` it audits a published Release instead. The release procedure
is in [PUBLISHING.md](PUBLISHING.md).

## License

Apache-2.0, same as [Neutrino](https://github.com/woodtong/neutrino).
