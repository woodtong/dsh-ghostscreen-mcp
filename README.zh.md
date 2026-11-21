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

**默认什么都不用做**：每次 DSH 启动，插件都会向 GitHub 检查最新 Release；比本地已装的
版本新时，就在后台静默下载 `GhostScreen-<version>-win-x64.zip`（约 200 MiB，发布方
提供 sha256 时校验），解压到 `%LOCALAPPDATA%\GhostScreen\app\versions\<版本>\`。
这个包同时包含桥接（`mcp\`）与桌面端本体（`cli\`、`tray\`），一次更新两者都覆盖。

插件页会显示更新状态：正在检查、下载中百分比、已下载待重启、失败原因 + 「立即检查」。
下次启动 DSH 时自动挂载新版本，并删除更早的版本目录（以及下载缓存）以节省空间。
页面不提供版本选择：永远运行"最新的托管版本"，除非你固定了本地构建（见下）。

检查失败（离线、网络受限）时插件在日志里打印指引，不挂载任何工具，DSH 会话其余部分
照常工作，页面会显示具体错误。

下载支持中断续传：连续 90 秒没有进展就放弃当前通道，从已下载的字节处续传，在
`curl`（遵循 `HTTPS_PROXY`）与内置 fetch 之间自动切换；临时文件先写成 `.part`，
完整下载后才改名进缓存，不会留下半截 zip。

### 托管版与固定版：谁跑哪一套

server 二进制只有两种来源，选择是**按机器**决定的，不是全局的：

| | 托管版（所有安装的默认） | 固定版（仅开发机） |
|---|---|---|
| exe 来自哪里 | GitHub 最新 Release，解压到 `%LOCALAPPDATA%\GhostScreen\app\versions\<版本>\` | `config.exePath` 或 `%GHOSTSCREEN_MCP_EXE%` 指定的路径 |
| 更新行为 | 每次启动检查，静默下载，下次启动挂载新版本并删除旧目录 | 自动更新照常下载，但永不切走固定的 exe |
| 谁在跑 | 所有未做固定的机器 | 只有设置了这个 pin 的那台机器 |

pin 只存在于该机器的 **profile** 配置里（`~/.dsh/profiles/<profile>/cordis.patch.yml`）。
插件自带 bundle patch 不含任何 `config` 层，所以新装一律从托管版开始。推荐的用法：

- **开发机**：pin 住本地 Release 构建，改完代码 Rebuild，下次启动 DSH 即生效，无需发版。
- **其他所有人**：不做任何固定，自动运行你发布的最新 Release——发版是改变用户端行为的唯一动作。

### 固定本地构建（开发用）

本地编译的 `GhostScreen.Mcp.exe` 仍可固定，只是不在配置页里提供：

```yaml
- id: ghostscreen-mcp-runtime
  name: dsh-ghostscreen-mcp
  config:
    exePath: 'D:\tools\GhostScreen\GhostScreen.Mcp.exe'
```

或者用环境变量 `GHOSTSCREEN_MCP_EXE`。固定的构建优先运行（插件页标注"外部指定构建"）；
自动更新照常把新版本下到托管目录，但不会切走外部指定的 exe。

解析顺序：`config.exePath` → `GHOSTSCREEN_MCP_EXE` → `versions\` 下最新的托管版本 →
旧布局（`app\GhostScreen-<ver>\mcp\`、`app\mcp\`、`app\GhostScreen.Mcp.exe`）。

其余 `config` 键：`args`、`env`（传给 server 进程的额外环境变量）、
`toolCallTimeoutMs`（默认交给桥接层）。下载与更新开关已取消——两者恒开。

插件页的状态来自宿主注册的只读路由 `GET /ghostscreen-mcp/status`（同源 JSON，
`?refresh=1` 触发一次立即检查）。

### 包自检

更新完成后（以及每次启动）宿主会看一眼解压出来的包，缺什么就在页面上给一行
warning：永远检查 `mcp\GhostScreen.Mcp.exe`，另外检查
`GhostScreen.Notifier\GhostScreen.Notifier.exe`——该目录从 GhostScreen **0.2.0**
才开始随包发布，更早的发布包没有属正常情况，文案里也这么写。这个检查纯提示：
不阻断启动、不自动修复、不影响下载流程。

## 验证

安装并重启 DSH 后，会话中出现 `mcp__ghostscreen__*` 工具。快速检查：调用
`mcp__ghostscreen__list_windows`，应列出当前可见的顶层窗口。

## 许可证

Apache-2.0，与 [Neutrino](https://github.com/woodtong/neutrino) 一致。
