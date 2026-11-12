# dsh-ghostscreen-mcp

Mounts the [GhostScreen (Neutrino)](https://github.com/woodtong/neutrino) MCP
server into every [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(DSH) session, giving the agent an **invisible screen**: real windows are
parked off the virtual desktop, captured with PrintWindow, and driven with
window messages / UIA behind a human consent gate. Headless web pages run in a
private headless Edge driven over CDP.

All 21 tools the server exposes are registered as `mcp__ghostscreen__<ToolName>`:

- Native windows: `list_windows`, `attach_window`, `screenshot`, `observe`,
  `click`, `click_element`, `set_text`, `key`, `drag`, `scroll`, `close_target`
- Headless web: `open_web`, `attach_cdp`, `navigate`, `get_html`, `snapshot`,
  `viewport`, `console`, `network`
- Safety & lifecycle: `list_targets`, `close_all`, `ControlStatus`-style state

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

1. Download the `GhostScreen-<version>-win-x64.zip` from the
   [Neutrino Releases](https://github.com/woodtong/neutrino/releases) page.
2. Extract it, then either:
   - run `scripts/install.ps1` from the extracted package — it installs to
     `%LOCALAPPDATA%\GhostScreen\app\` and this plugin finds
     `mcp\GhostScreen.Mcp.exe` there automatically; **or**
   - copy `mcp\GhostScreen.Mcp.exe` anywhere you like and point the plugin at
     it (next section).

If the exe is missing at startup, the plugin logs exactly this guidance, mounts
nothing, and the rest of the DSH session keeps working normally.

### Pointing at a custom exe location

The plugin resolves the exe in this order:

1. `exePath` in the plugin row's `config` — override in your profile's
   `cordis.patch.yml`:

   ```yaml
   - id: ghostscreen-mcp-runtime
     name: dsh-ghostscreen-mcp
     config:
       exePath: 'D:\tools\GhostScreen\GhostScreen.Mcp.exe'
   ```

2. The `GHOSTSCREEN_MCP_EXE` environment variable (full path to the exe).
3. Default install locations:
   `%LOCALAPPDATA%\GhostScreen\app\mcp\GhostScreen.Mcp.exe`, then
   `%LOCALAPPDATA%\GhostScreen\GhostScreen.Mcp.exe`.

Other supported `config` keys: `toolCallTimeoutMs` (default left to the
bridge), `args`, `env` (extra environment variables for the server process).

## Verification

After installing and restarting DSH, the `mcp__ghostscreen__*` tools appear in
the session. Quick check: call `mcp__ghostscreen__list_windows` — it should
list your visible top-level windows.

## License

Apache-2.0, same as [Neutrino](https://github.com/woodtong/neutrino).
