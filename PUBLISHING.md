# 发布手册（PUBLISHING）

本文件记录 `dsh-ghostscreen-mcp` 从「本地插件」到「市场可安装」的完整发布链路。
它不随 npm 包发布（`package.json` 的 `files` 白名单不含本文件），只给维护者看。

- 插件仓库：<https://github.com/woodtong/dsh-ghostscreen-mcp>
- 上游产品：<https://github.com/woodtong/neutrino>（GhostScreen / 中微子）
- 市场数据源：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin> 的 `data/plugins/`

## 两条发布线，别混

| | 仓库 | 产物 | 谁消费 |
|---|---|---|---|
| 产品线 | `woodtong/neutrino` | `GhostScreen-<ver>-win-x64.zip`（含 exe，约 200 MiB） | 装了 GhostScreen 的用户 |
| 插件线 | `woodtong/dsh-ghostscreen-mcp` | `dsh-ghostscreen-mcp.tgz`（纯 JS 外壳，约 77 KB，不含任何二进制） | 从市场装插件的用户 |

插件从 0.2.0 起**每次 DSH 启动都会检查产品线的最新 Release** 并静默下载，
因此：产品线发版 → 插件用户自动跟上；插件线只在**插件自身代码变化**时才需要发版。
两条线的版本号互不相关。

## 第 0 步：发布前自检

```powershell
cd E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp
git status                          # 必须是干净的；脏工作区会打出与 tag 不符的包
node tools\selfcheck.mjs --local --offline   # 发布门禁，约 10 秒：应 18/18 PASS
node tools\selfcheck.mjs --local              # 再加一项真实下载（约 200 MiB），应 19/19
```

`tools\selfcheck.mjs` 不进 npm 包，只给维护者用。它做的事：

- `--local`：按 `package.json` 的 `files` 白名单把**工作区**复制到临时目录（等价于
  `npm pack --dry-run`，但真的解包出来检查）。
- 不加 `--local`：审计**已发布的 Release**——下载版本无关附件、核对 tag、市场条目、
  市场目录、附件哈希，并在干净的临时 `%LOCALAPPDATA%` 下真实走一遍首次下载（应 25/25）。
- 行为测试对着一个**假的 GitHub** 跑（不联网、不启动任何 `GhostScreen.Mcp.exe`，不碰真实的
  `%LOCALAPPDATA%\GhostScreen`）：离线首启只打引导并排定重试、网络恢复后「立即检查」一次
  装好并立即挂载、后台重试自愈、重试恰好 4 次后停止、停用插件取消重试、启动时发现新版
  只下载不换桥、连续保存设置不泄漏 server 进程。
- 任一项失败即 `exit 1`。依赖前一项的后续检查会标 `SKIP` 并写出真实原因，不要当成独立故障。

下面六件事里，1–4、6 以及「两个 README 的工具数互相对齐」都由脚本自动查；「版本 = tag」要等
tag 打出来后用不带 `--local` 的模式查；「工具数与 GhostScreen 实际 Release 一致」脚本查不了
（它不知道 server 暴露了哪些工具），仍然要人工对照产品仓库的 `doc/03-接口设计.md`。

1. **`files` 白名单**覆盖新文件——`index.mjs`、`lib/client.js`、`locale/*.json`、
   `icon.svg`、`cordis.patch.yml`、两个 README、`LICENSE`、`screenshots.json`、
   `screenshots/`。漏一项就会静默丢功能。
2. **`dsh.bundle` 存在**（`{"bundle":{"patch":"./cordis.patch.yml"}}`）。市场 CI 只认
   `dsh.bundle`，只声明 `dsh.client` 会被直接拒。
3. **`scripts` 为空**——安装期不能有构建脚本，否则 npm 安装会要求 `allowBuilds` 授权。
4. **每个 `peerDependencies` 范围都带显式预发布分支**（现为
   `@deepseek-ai/dsh-mcp-client: >=0.1.0-rc.6 <1.0.0-0` 与
   `@deepseek-ai/schemastery: >=3.18.5-0 <4.0.0-0`）。范围里必须有一个落在同一
   major.minor.patch 元组且自带预发布标签的比较符，否则 node-semver 会静默排除 harness 的
   预发布构建，用户 `npm install` 直接 `ERESOLVE`。v0.2.3 的 `~3.18.5` 就违反了这一条，
   市场的 CI 不查它，是自检脚本查出来的。
5. **工具数、功能描述与实际 Release 一致**。市场评审会对着代码核描述，数字写错是被退回
   的头号原因。当前 GhostScreen 0.2.0 暴露 **25 个**工具。
6. **`package.json` 不能有 UTF-8 BOM**。DSH 读 `package.json` 时不做去 BOM，带 BOM 会让
   `JSON.parse` 直接失败，装完识别不到 `dsh.bundle`（2026-11-21 就因此被市场退回一次）。
   `node -e` 里的 `require('./package.json')` 会替你去掉 BOM，所以它测不出来，必须看字节
   （自检脚本会遍历包内所有文本文件逐个查）：

```powershell
$b = [System.IO.File]::ReadAllBytes("$PWD\package.json"); $b[0..2] -join ','
# 应为 123,10,32（"{" + 换行 + 空格）；239,187,191 就是 BOM
```

## 第 1 步：仓库与 topic（只做一次）

```powershell
gh repo view woodtong/dsh-ghostscreen-mcp
gh repo edit woodtong/dsh-ghostscreen-mcp --add-topic dsh-plugin
```

`dsh-plugin` topic 是收录的硬性要求。仓库**建满 24 小时**才能过收录 CI 的年龄检查
（`MIN_AGE_DAYS=1`）；不够时 gate 会自己重跑，不需要推空提交。

## 第 2 步：打 tag 并发 Release

```powershell
cd E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp
$ver = node -p "require('./package.json').version"     # 版本号只写在 package.json 里，tag 必须与它一致
git tag "v$ver"
git push origin "v$ver"

npm pack                                                # 产出 dsh-ghostscreen-mcp-$ver.tgz
Copy-Item "dsh-ghostscreen-mcp-$ver.tgz" dsh-ghostscreen-mcp.tgz   # 关键：改成版本无关名
gh release create "v$ver" --title "v$ver" --notes-file <发布说明.md>
gh release upload "v$ver" dsh-ghostscreen-mcp.tgz --clobber
node tools\selfcheck.mjs --tag "v$ver"                  # 公网复验：附件、哈希、市场条目、真实首次下载
```

注意 `npm pack` 打的是**磁盘上的文件**，不是某个 commit。工作区有未提交改动时，打出来的包与
tag 指向的代码不一致——要么先提交，要么 `git worktree add --detach <目录> <sha>` 到干净副本里打包。

**为什么附件必须叫版本无关的 `dsh-ghostscreen-mcp.tgz`**：市场条目里的下载地址是
`releases/latest/download/dsh-ghostscreen-mcp.tgz`。`latest` 在请求时才解析，但**文件名是
照字面取的**。若附件名称带版本号，链接在提交当天有效、下一次发版立刻 404，而且没人会察觉。

**建议拆成「建 Release」和「传附件」两步**：`api.github.com` 与 `uploads.github.com` 在受限
网络（例如走本地代理）下常出现 `net/http: TLS handshake timeout`。拆开后附件上传可反复重试，
tag 与 Release 本身不受影响。

验收：

```powershell
gh release list -R woodtong/dsh-ghostscreen-mcp
Invoke-WebRequest https://github.com/woodtong/dsh-ghostscreen-mcp/releases/latest/download/dsh-ghostscreen-mcp.tgz -OutFile $env:TEMP\check.tgz
(Get-FileHash $env:TEMP\check.tgz -Algorithm SHA256).Hash   # 应与本地 dsh-ghostscreen-mcp.tgz 一致
```

## 第 3 步（可选）：发布到 npm

```powershell
npm publish --access public
```

好处：预构建安装跳过构建授权流程。需要先 `npm login`，且包名未被占用。

## 第 4 步：收录 PR

```powershell
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin
git checkout -b add-dsh-ghostscreen-mcp
Copy-Item ..\dsh-ghostscreen-mcp\market\woodtong__dsh-ghostscreen-mcp.yml data\plugins\
git add data/plugins/woodtong__dsh-ghostscreen-mcp.yml
git commit -m "Add woodtong/dsh-ghostscreen-mcp"
git push -u origin add-dsh-ghostscreen-mcp
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin --fill
```

规则（来自 `contributing.md`）：

- **一个 PR 只加一个文件** `data/plugins/<owner>__<repo>.yml`；两个 README 由脚本生成，**绝不手改**。
- `description.en` 必填，`zh` 可选；描述里有「冒号+空格」必须给整行加引号，否则 YAML 解析失败。
- `category` 从固定清单里选（本条目用 `tools`）；选偏了维护者会直接改，不会打回。
- 条目文件必须是 **UTF-8 无 BOM**、LF 换行——PowerShell 的 `Set-Content -Encoding UTF8`
  在 Windows PowerShell 下会写 BOM 并把中文转坏，改这个文件请用编辑器或 `write` 工具。
- 另一个 PR 上限：**3 条**。
- 被挂 `held: author` 不算拒稿：把修改推回同一分支，留**一条**评论说明改了什么即可。

## 第 5 步：干净安装验收

用一个空 profile，模拟真实的「从市场装插件」：

```powershell
dsh plugin --profile verify add woodtong/dsh-ghostscreen-mcp
```

预期：

1. 插件装好，`~/.dsh/profiles/verify/cordis.patch.yml` 出现 `ghostscreen-mcp-runtime` 行。
2. 首次启动 DSH 时日志显示检查最新 Release → 下载进度 → 解压到
   `%LOCALAPPDATA%\GhostScreen\app\versions\<ver>\`，**下载完成后当次会话即挂载**，不用重启。
3. `mcp__ghostscreen__*` 工具出现，`list_windows` 能列出窗口。
4. 之后产品线发新版：启动时只下载，页面提示「下次启动切换」，下一次启动挂载新版本并清理旧目录。
5. 断网时只打印指引、不挂载，会话不崩；插件页显示失败原因与下次自动重试的时间，
   网络恢复后自动装好并挂载，「立即检查」可跳过等待。

没有 DSH 命令行时，第 2、4、5 条的行为可以离线复现：`node tools\selfcheck.mjs --local`
对着假的 GitHub 跑的就是同一套逻辑。

开发机想跑本地构建时，在 profile 的 `cordis.patch.yml` 里给该行加 `config.exePath`，
或设 `GHOSTSCREEN_MCP_EXE` 环境变量——固定构建永远优先于托管版本，自动更新只会下载不切换。
