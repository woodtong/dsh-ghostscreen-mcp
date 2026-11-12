import { existsSync } from "node:fs";
import { join } from "node:path";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";

export const name = "dsh-ghostscreen-mcp";
export const inject = ["tools"];

const RELEASES_URL = "https://github.com/woodtong/neutrino/releases";
const DEFAULT_INSTALL_DIRS = [
  // Layout produced by WindowsForAgent scripts/install.ps1
  ["LOCALAPPDATA", ["GhostScreen", "app", "mcp", "GhostScreen.Mcp.exe"]],
  // Manual-unzip convention: drop the release's mcp\GhostScreen.Mcp.exe
  // (or the exe itself) directly into %LOCALAPPDATA%\GhostScreen\
  ["LOCALAPPDATA", ["GhostScreen", "GhostScreen.Mcp.exe"]],
];

function candidatePaths(config) {
  const candidates = [];
  const fromConfig = config?.exePath ?? config?.command;
  if (fromConfig) candidates.push(fromConfig);
  const fromEnv = process.env.GHOSTSCREEN_MCP_EXE;
  if (fromEnv) candidates.push(fromEnv);
  for (const [envVar, parts] of DEFAULT_INSTALL_DIRS) {
    const root = process.env[envVar];
    if (root) candidates.push(join(root, ...parts));
  }
  return candidates;
}

const MISSING_EXE_HELP = [
  "[dsh-ghostscreen-mcp] GhostScreen.Mcp.exe not found - the ghostscreen tools are NOT mounted.",
  "Tried, in order: config exePath -> %GHOSTSCREEN_MCP_EXE% -> default install locations under %LOCALAPPDATA%\\GhostScreen.",
  "To fix, pick ONE of:",
  "  1. Download the win-x64 zip from " + RELEASES_URL + " (latest Release),",
  "     extract it, and run scripts/install.ps1 from the extracted package.",
  "     This installs the MCP server to %LOCALAPPDATA%\\GhostScreen\\app\\mcp\\GhostScreen.Mcp.exe",
  "     which this plugin finds automatically.",
  "  2. Or copy GhostScreen.Mcp.exe anywhere and point this plugin at it, either by",
  "     setting the GHOSTSCREEN_MCP_EXE environment variable to the full exe path,",
  "     or by overriding this plugin's row in your profile's cordis.patch.yml:",
  "       - id: ghostscreen-mcp-runtime",
  "         name: dsh-ghostscreen-mcp",
  "         config:",
  "           exePath: 'C:\\path\\to\\GhostScreen.Mcp.exe'",
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
 * Startup failure is contained: if the exe is missing, the plugin logs setup
 * guidance and the rest of the session keeps working without the ghostscreen
 * tools.
 */
export function apply(ctx, config = {}) {
  const candidates = candidatePaths(config);
  const exe = candidates.find((p) => existsSync(p));

  if (!exe) {
    ctx.logger?.error?.(MISSING_EXE_HELP);
    if (candidates.length) {
      ctx.logger?.error?.(
        "[dsh-ghostscreen-mcp] paths checked:\n  " + candidates.join("\n  ")
      );
    }
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
