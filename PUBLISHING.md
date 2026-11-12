# 发布手册（PUBLISHING）

本文件是发布操作手册，不属于插件运行的一部分。所有需要 GitHub 账号操作的最后一步
由仓库主人手动执行；下面每一步都给出精确命令与预期效果。

本地仓库：`E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp`（已 git init、
已提交、main 分支、commit b644a77+）。代码已通过：语法检查、npm pack 干跑
（无安装期构建脚本）、三级 exe 路径解析的单测（缺失→引导日志不挂载；
env 覆盖；config exePath 优先）。

## 第 0 步：人工核对（发布前必做）

- [ ] 打开 `screenshots/invisible-window-capture.png` 看一眼：右侧应显示一个
      内容为 "GhostScreen demo" 的记事本窗口（由 GhostScreen 在屏幕外捕获），
      不应包含任何私人桌面内容。不满意就重拍（见下"重拍截图"）。
- [ ] 打开 `README.md` / `README.zh.md` 通读一遍。

## 第 1 步：创建 GitHub 仓库并推送

在 https://github.com/new 创建 `dsh-ghostscreen-mcp`（Public，不要勾选任何
初始化文件——本地已有 LICENSE/README），然后：

```powershell
cd E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp
git remote add origin https://github.com/woodtong/dsh-ghostscreen-mcp.git
git push -u origin main
```

预期：推送成功，仓库出现 9 个文件。

**然后立刻给仓库加 topic `dsh-plugin`**（收录硬性要求，CI 会查）：
网页上：仓库页 → 齿轮 About → Topics 输入 `dsh-plugin`；或命令行：

```powershell
gh repo edit woodtong/dsh-ghostscreen-mcp --add-topic dsh-plugin
```

> ⏰ 仓库创建时间从 push 算起要满 1 天 CI 才放行收录 PR。
> 记下创建时刻，24 小时后再做第 4 步。

## 第 2 步：打 tag 并发布 Release（附 plugin.tgz）

```powershell
cd E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp
git tag v0.1.0
git push origin v0.1.0
npm pack   # 产出 dsh-ghostscreen-mcp-0.1.0.tgz
Copy-Item dsh-ghostscreen-mcp-0.1.0.tgz dsh-ghostscreen-mcp.tgz   # 版本无关文件名，latest/download/ 链接永不失效
gh release create v0.1.0 dsh-ghostscreen-mcp.tgz --title "v0.1.0" --notes "First public release. Mounts the GhostScreen (Neutrino) MCP server; exe path resolved via config exePath / GHOSTSCREEN_MCP_EXE / %LOCALAPPDATA%\GhostScreen defaults."
```

预期：Release 页面出现 `dsh-ghostscreen-mcp.tgz` 资产；市场条目里的
`tarball: https://github.com/woodtong/dsh-ghostscreen-mcp/releases/latest/download/dsh-ghostscreen-mcp.tgz`
即可下载。

已验证 `npm pack` 内容：index.mjs、cordis.patch.yml、README、README.zh.md、
LICENSE、package.json、screenshots.json、screenshots/ ——package.json 无
scripts 字段，安装时不执行任何构建脚本。

## 第 3 步（可选，推荐）：发布 npm

```powershell
npm publish --access public
```

预期：npmjs 出现 dsh-ghostscreen-mcp@0.1.0；市场自动关联下载量
（package.json 的 repository 字段已指向本仓库，无需额外声明）。

## 第 4 步：收录 PR（创建满 1 天后）

条目文件已备好：本仓库 `market/woodtong__dsh-ghostscreen-mcp.yml`
（内容符合 contributing.md：只加一个文件、category 从固定清单选 tools、
描述只讲功能且与 package.json 一致、tarball 用版本无关文件名）。

```powershell
cd $env:TEMP
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin
git checkout -b add-dsh-ghostscreen-mcp
Copy-Item E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp\market\woodtong__dsh-ghostscreen-mcp.yml data\plugins\
git add data/plugins/woodtong__dsh-ghostscreen-mcp.yml
git commit -m "Add woodtong/dsh-ghostscreen-mcp"
git push -u origin add-dsh-ghostscreen-mcp
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin --title "Add woodtong/dsh-ghostscreen-mcp" --body "Adds one entry: a DSH plugin that mounts the GhostScreen (Neutrino) MCP server (off-screen window capture, non-focus-stealing input, headless-Edge web automation). Repo declares dsh.bundle, ships a Release tarball, and has the dsh-plugin topic."
```

预期：CI 跑 4 项检查（条目数 / dsh.bundle / 仓库年龄 / awesome-lint+站点构建）。
若被 `held: author`，按 PR 评论改 yml 后推同一分支并留一条说明评论即可。
合并后网站与 dshmarket 每日自动刷新。

## 第 5 步：干净安装验收（不用等 GitHub，本地就能先做）

在 GitHub 仓库就绪后（或直接用本地路径先测）：

```powershell
# A. 缺 exe 引导：用临时 profile 安装，不配置任何路径
dsh plugin --profile test-gs add woodtong/dsh-ghostscreen-mcp   # 或 add E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp
# 启动该 profile，日志应出现 [dsh-ghostscreen-mcp] ... not found 引导
# （下载 Release、install.ps1、GHOSTSCREEN_MCP_EXE、cordis.patch.yml 四条路径），
# 会话本身正常，仅无 mcp__ghostscreen__* 工具。

# B. 配 exePath 后工具出现：
#    在 profiles\test-gs\cordis.patch.yml 加：
#      - id: ghostscreen-mcp-runtime
#        name: dsh-ghostscreen-mcp
#        config:
#          exePath: 'E:\software_code\...\GhostScreen.Mcp.exe'
#    重启，调用 mcp__ghostscreen__list_windows 应列出窗口；
#    mcp__ghostscreen__open_web 应打开 headless 页面。
```

## 本机 profile 已做的适配

- `~\.dsh\local\dsh-ghostscreen-mcp\` 已同步为新代码（下次 DSH 重启生效）。
- `~\.dsh\profiles\desktop\cordis.patch.yml` 末尾已加
  `ghostscreen-mcp-runtime` 的 config.exePath 指向当前 Release 构建产物，
  所以桌面 profile 行为不变。

## 重拍截图（如需要）

```powershell
Set-Content $env:TEMP\gs-demo.txt "GhostScreen demo ..."
Start-Process notepad.exe "$env:TEMP\gs-demo.txt"; Start-Sleep 3
$h = & E:\software_code\Visual_Stdio_Code\WindowsForAgent\artifacts\GhostScreen-0.1.0\cli\GhostScreen.Cli.exe list | ? {$_ -match 'Notepad'} | % {($_ -split '\s+')[0]} | Select -First 1
& E:\software_code\Visual_Stdio_Code\WindowsForAgent\artifacts\GhostScreen-0.1.0\cli\GhostScreen.Cli.exe shot --hwnd $h --out <repo>\screenshots\invisible-window-capture.png --confirm
```
（再按需重做对比合成图。）
