# dsh-ghostscreen-mcp

把 [GhostScreen（中微子 / Neutrino）](https://github.com/woodtong/neutrino) 的 MCP server 挂载进每个
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）会话，让 Agent 用一块
**人类看不见的屏幕**：真实窗口被停到虚拟桌面之外，用 PrintWindow 捕获，通过窗口消息 /
UIA 在「人工同意门」之后驱动；无头网页跑在私有 headless Edge 里，经 CDP 控制。

server 提供的全部 21 个工具注册为 `mcp__ghostscreen__<ToolName>`：

- 原生窗口：`list_windows`、`attach_window`、`screenshot`、`observe`、`click`、
  `click_element`、`set_text`、`key`、`drag`、`scroll`、`close_target`
- 无头网页：`open_web`、`attach_cdp`、`navigate`、`get_html`、`snapshot`、
  `viewport`、`console`、`network`
- 安全与生命周期：`list_targets`、`close_all`、`ControlStatus` 式状态查询

安全不变量：不抢前台、不动真实光标、不改剪贴板；人在用电脑时，UIA 动作先经
非激活式协商窗征得同意。

## 环境要求

- Windows 10/11，DSH 自带官方 MCP 客户端桥
  （`@deepseek-ai/dsh-mcp-client` >= 0.1.0-rc.6，随 DSH 提供）
- GhostScreen MCP server 可执行文件（`GhostScreen.Mcp.exe`），从 Neutrino
  Release 获取（见下）。本插件**不带任何二进制**，也不收集数据。

## 安装

```powershell
dsh plugin --profile <profile> add woodtong/dsh-ghostscreen-mcp
```

（发布 npm 后也可：`dsh plugin add dsh-ghostscreen-mcp`）

### 获取 GhostScreen.Mcp.exe

**默认什么都不用做**：首次启动发现 exe 缺失时，插件会自动从
[Neutrino Releases](https://github.com/woodtong/neutrino/releases) 下载最新的
`GhostScreen-<version>-win-x64.zip`（约 200 MiB，日志有进度），解压到
`%LOCALAPPDATA%\GhostScreen\app\` 并挂载。想手动管理的话二选一：

1. 下载 zip 后运行解压包里的 `scripts/install.ps1` —— 它会安装到
   `%LOCALAPPDATA%\GhostScreen\app\`，插件自动找到其中的
   `mcp\GhostScreen.Mcp.exe`；**或**
2. 把 `mcp\GhostScreen.Mcp.exe` 放到任意位置，按下节指给插件。

自动下载失败（离线、网络受限）或被 `config.autoDownload: false` 关闭时，插件在
日志里打印指引，不挂载任何工具，DSH 会话其余部分照常工作。

### 指定 exe 位置

插件按以下顺序解析 exe 路径：

1. 插件行的 `config.exePath` —— 在你 profile 的 `cordis.patch.yml` 里覆盖：

   ```yaml
   - id: ghostscreen-mcp-runtime
     name: dsh-ghostscreen-mcp
     config:
       exePath: 'D:\tools\GhostScreen\GhostScreen.Mcp.exe'
   ```

2. 环境变量 `GHOSTSCREEN_MCP_EXE`（exe 完整路径）。
3. 默认安装位置：`%LOCALAPPDATA%\GhostScreen\app\` 下的自动下载 /
   install.ps1 布局（`app\GhostScreen-<ver>\mcp\GhostScreen.Mcp.exe` 或
   `app\mcp\GhostScreen.Mcp.exe`），其次 `%LOCALAPPDATA%\GhostScreen\GhostScreen.Mcp.exe`。

其余 `config` 键：`autoDownload`（默认 true，exe 缺失时自动下载最新 Release）、
`autoUpdate`（默认 true，每天在线检查一次主体版本，落后就在后台下好新版本、
重启 DSH 后自动切换；显式 `exePath`/`GHOSTSCREEN_MCP_EXE` 指定的安装不受自动更新管理）、
`toolCallTimeoutMs`（默认交给桥接层）、`args`、`env`
（传给 server 进程的额外环境变量）。

自动下载/升级的各版本安装在
`%LOCALAPPDATA%\GhostScreen\app\versions\<版本>\`，插件每次启动选版本最高者；
检查结果缓存于 `app\update-check.json`（每天最多查一次，避开 GitHub 限流），
zip 缓存于 `GhostScreen\downloads\`（同版本不重复下载）。

## 验证

安装并重启 DSH 后，会话中出现 `mcp__ghostscreen__*` 工具。快速检查：调用
`mcp__ghostscreen__list_windows`，应列出当前可见的顶层窗口。

## 许可证

Apache-2.0，与 [Neutrino](https://github.com/woodtong/neutrino) 一致。
