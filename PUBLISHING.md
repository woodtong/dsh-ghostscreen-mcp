# 鍙戝竷鎵嬪唽锛圥UBLISHING锛?
鏈枃浠舵槸鍙戝竷鎿嶄綔鎵嬪唽锛屼笉灞炰簬鎻掍欢杩愯鐨勪竴閮ㄥ垎銆傛墍鏈夐渶瑕?GitHub 璐﹀彿鎿嶄綔鐨勬渶鍚庝竴姝?鐢变粨搴撲富浜烘墜鍔ㄦ墽琛岋紱涓嬮潰姣忎竴姝ラ兘缁欏嚭绮剧‘鍛戒护涓庨鏈熸晥鏋溿€?
鏈湴浠撳簱锛歚E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp`锛堝凡 git init銆?宸叉彁浜ゃ€乵ain 鍒嗘敮锛夈€傚綋鍓嶄唬鐮佸凡閫氳繃锛歚node --check`銆乶pm pack 骞茶窇锛堟棤瀹夎鏈熸瀯寤?鑴氭湰锛夈€佷互鍙婃闈?profile 涓婄殑鐪熸満绔埌绔獙璇侊紙0.2.1锛氶娆″惎鍔ㄦ鏌?鈫?闈欓粯涓嬭浇
207 MiB 鈫?sha256 鏍￠獙 鈫?瑙ｅ帇鍒?`versions\0.1.0\` 鈫?閲嶅惎鍓嶆姤 "up to date"锛?鍖呰嚜妫€ warn 钀藉湪 `versions\0.1.0` 涓婏紝鍥犱负璇ョ増鏃╀簬 notifier 鐩綍锛夈€?
鍙戝竷妯″瀷锛堥噸瑕侊級锛?*鍙戠増鏄敼鍙樼敤鎴风琛屼负鐨勫敮涓€鍔ㄤ綔**銆傜敤鎴风 profile 娌℃湁 pin锛?瀹夎鍚庤嚜鍔ㄨ窡 GitHub 鏈€鏂?Release 璧帮紱鏈満寮€鍙戝垯鐢?`config.exePath` pin 浣忔湰鍦?Release 鏋勫缓锛堣 README銆屾墭绠＄増涓庡浐瀹氱増銆嶏級銆?
## 绗?0 姝ワ細浜哄伐鏍稿锛堝彂甯冨墠蹇呭仛锛?
- [ ] 鎵撳紑 `screenshots/invisible-window-capture.png` 鐪嬩竴鐪硷細鍙充晶搴旀樉绀轰竴涓?      鍐呭涓?"GhostScreen demo" 鐨勮浜嬫湰绐楀彛锛堢敱 GhostScreen 鍦ㄥ睆骞曞鎹曡幏锛夛紝
      涓嶅簲鍖呭惈浠讳綍绉佷汉妗岄潰鍐呭銆備笉婊℃剰灏遍噸鎷嶏紙瑙佷笅"閲嶆媿鎴浘"锛夈€?- [ ] 鎵撳紑 `README.md` / `README.zh.md` 閫氳涓€閬嶃€?
## 绗?1 姝ワ細鍒涘缓 GitHub 浠撳簱骞舵帹閫?
鍦?https://github.com/new 鍒涘缓 `dsh-ghostscreen-mcp`锛圥ublic锛屼笉瑕佸嬀閫変换浣?鍒濆鍖栨枃浠垛€斺€旀湰鍦板凡鏈?LICENSE/README锛夛紝鐒跺悗锛?
```powershell
cd E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp
git remote add origin https://github.com/woodtong/dsh-ghostscreen-mcp.git
git push -u origin main
```

棰勬湡锛氭帹閫佹垚鍔燂紝浠撳簱鏍圭洰褰曞嚭鐜?11 涓枃浠讹紙鍚?`lib/`銆乣locale/`銆乣icon.svg`锛夈€?
**鐒跺悗绔嬪埢缁欎粨搴撳姞 topic `dsh-plugin`**锛堟敹褰曠‖鎬ц姹傦紝CI 浼氭煡锛夛細
缃戦〉涓婏細浠撳簱椤?鈫?榻胯疆 About 鈫?Topics 杈撳叆 `dsh-plugin`锛涙垨鍛戒护琛岋細

```powershell
gh repo edit woodtong/dsh-ghostscreen-mcp --add-topic dsh-plugin
```

> 鈴?浠撳簱鍒涘缓鏃堕棿浠?push 绠楄捣瑕佹弧 1 澶?CI 鎵嶆斁琛屾敹褰?PR銆?> 璁颁笅鍒涘缓鏃跺埢锛?4 灏忔椂鍚庡啀鍋氱 4 姝ャ€?
## 绗?2 姝ワ細鎵?tag 骞跺彂甯?Release锛堥檮 plugin.tgz锛?
```powershell
cd E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp
git tag v0.2.1
git push origin v0.2.1
npm pack   # 浜у嚭 dsh-ghostscreen-mcp-0.2.1.tgz
Copy-Item dsh-ghostscreen-mcp-0.2.1.tgz dsh-ghostscreen-mcp.tgz   # 鐗堟湰鏃犲叧鏂囦欢鍚嶏紝latest/download/ 閾炬帴姘镐笉澶辨晥
gh release create v0.2.1 dsh-ghostscreen-mcp.tgz --title "v0.2.1" --notes "No more version picker: every DSH start checks the newest GhostScreen release, silently downloads it (curl with node-fetch fallback, resumable, sha256-verified), activates it on the next start and deletes older version folders. New in-page configuration (args / env / timeout) plus a live update card fed by the read-only /ghostscreen-mcp/status route, and a package self-check that warns when mcp\GhostScreen.Mcp.exe or GhostScreen.Notifier\GhostScreen.Notifier.exe is missing (the notifier folder ships since GhostScreen 0.2.0, so older packages legitimately lack it). Local builds stay pinnable via config.exePath or GHOSTSCREEN_MCP_EXE for development."
```

棰勬湡锛歊elease 椤甸潰鍑虹幇 `dsh-ghostscreen-mcp.tgz` 璧勪骇锛涘競鍦烘潯鐩噷鐨?`tarball: https://github.com/woodtong/dsh-ghostscreen-mcp/releases/latest/download/dsh-ghostscreen-mcp.tgz`
鍗冲彲涓嬭浇銆?
宸查獙璇?`npm pack --dry-run` 鍐呭鍏?12 涓枃浠讹細index.mjs銆乴ib/client.js銆?cordis.patch.yml銆乴ocale/en.json銆乴ocale/zh.json銆乮con.svg銆丷EADME.md銆?README.zh.md銆丩ICENSE銆乸ackage.json銆乻creenshots.json銆乻creenshots/ 鈥斺€?package.json 鏃?scripts 瀛楁锛屽畨瑁呮椂涓嶆墽琛屼换浣曟瀯寤鸿剼鏈€?
## 绗?3 姝ワ紙鍙€夛紝鎺ㄨ崘锛夛細鍙戝竷 npm

```powershell
npm publish --access public
```

棰勬湡锛歯pmjs 鍑虹幇 dsh-ghostscreen-mcp@0.2.1锛涘競鍦鸿嚜鍔ㄥ叧鑱斾笅杞介噺
锛坧ackage.json 鐨?repository 瀛楁宸叉寚鍚戞湰浠撳簱锛屾棤闇€棰濆澹版槑锛夈€?
## 绗?4 姝ワ細鏀跺綍 PR锛堝垱寤烘弧 1 澶╁悗锛?
鏉＄洰鏂囦欢宸插濂斤細鏈粨搴?`market/woodtong__dsh-ghostscreen-mcp.yml`
锛堝唴瀹圭鍚?contributing.md锛氬彧鍔犱竴涓枃浠躲€乧ategory 浠庡浐瀹氭竻鍗曢€?tools銆?鎻忚堪鍙鍔熻兘涓斾笌 package.json 涓€鑷淬€乼arball 鐢ㄧ増鏈棤鍏虫枃浠跺悕锛夈€?
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

棰勬湡锛欳I 璺?4 椤规鏌ワ紙鏉＄洰鏁?/ dsh.bundle / 浠撳簱骞撮緞 / awesome-lint+绔欑偣鏋勫缓锛夈€?鑻ヨ `held: author`锛屾寜 PR 璇勮鏀?yml 鍚庢帹鍚屼竴鍒嗘敮骞剁暀涓€鏉¤鏄庤瘎璁哄嵆鍙€?鍚堝苟鍚庣綉绔欎笌 dshmarket 姣忔棩鑷姩鍒锋柊銆?
## 绗?5 姝ワ細骞插噣瀹夎楠屾敹锛堜笉鐢ㄧ瓑 GitHub锛屾湰鍦板氨鑳藉厛鍋氾級

鍦?GitHub 浠撳簱灏辩华鍚庯紙鎴栫洿鎺ョ敤鏈湴璺緞鍏堟祴锛夛細

```powershell
# A. 骞插噣瀹夎锛氱敤涓存椂 profile 瀹夎锛屼笉閰嶇疆浠讳綍璺緞
dsh plugin --profile test-gs add woodtong/dsh-ghostscreen-mcp   # 鎴?add E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp
# 鍚姩璇?profile锛屾棩蹇楀簲鍑虹幇锛?#   [dsh-ghostscreen-mcp] downloading GhostScreen v<ver> ... 鈫?sha256 ok 鈫?installed at ...
# 闅忓悗 bridge mounted锛坰ource=managed锛夛紝/ghostscreen-mcp/status 杩斿洖 JSON銆?# 娉ㄦ剰锛氶娆′細鐪熶笅杞?~200 MiB锛涜嫢涓嬭浇澶辫触锛岄〉闈㈡樉绀洪敊璇紝浼氳瘽浠嶆甯搞€佷粎鏃犲伐鍏枫€?
# B. 閰?exePath 鍚庤蛋寮€鍙戞瀯寤猴紙external锛夛細
#    鍦?profiles\test-gs\cordis.patch.yml 鍔狅細
#      - id: ghostscreen-mcp-runtime
#        name: dsh-ghostscreen-mcp
#        config:
#          exePath: 'E:\software_code\...\GhostScreen.Mcp.exe'
#    閲嶅惎锛屾棩蹇楀嚭鐜?bridge mounted ... (external)锛?#    mcp__ghostscreen__list_windows 搴斿垪鍑虹獥鍙ｏ紝open_web 搴旀墦寮€ headless 椤甸潰銆?```

## 鏈満 profile 宸插仛鐨勯€傞厤

- `~\.dsh\local\dsh-ghostscreen-mcp\` 鐨勬棫鍓湰宸插垹闄わ紱鐜板湪
  `~\.dsh\profiles\desktop\node_modules\dsh-ghostscreen-mcp` 鏄寚鍚戞湰浠撳簱
  `E:\software_code\Visual_Stdio_Code\dsh-ghostscreen-mcp` 鐨?Junction锛?  鏀瑰畬浠ｇ爜 `dsh plugin` 渚т笉鐢ㄩ噸瑁咃紝閲嶅惎 DSH 鍗崇敓鏁堛€?- `~\.dsh\profiles\desktop\cordis.patch.yml` 鏈熬鏈夋満鍣ㄥ啓鍏ュ潡锛屾妸
  `ghostscreen-mcp-runtime` 鐨?`config.exePath` 鎸囧悜 WindowsForAgent 鐨?Release
  鏋勫缓浜х墿 鈥斺€?鎵€浠ユ湰鏈鸿窇鐨勬槸寮€鍙戞瀯寤猴紙鏃ュ織鏍?`(external)`锛夛紝鑷姩鏇存柊鍙湪鍚庡彴
  缁存姢 `%LOCALAPPDATA%\GhostScreen\app\versions\`銆?
## 閲嶆媿鎴浘锛堝闇€瑕侊級

```powershell
Set-Content $env:TEMP\gs-demo.txt "GhostScreen demo ..."
Start-Process notepad.exe "$env:TEMP\gs-demo.txt"; Start-Sleep 3
$h = & E:\software_code\Visual_Stdio_Code\WindowsForAgent\artifacts\GhostScreen-0.1.0\cli\GhostScreen.Cli.exe list | ? {$_ -match 'Notepad'} | % {($_ -split '\s+')[0]} | Select -First 1
& E:\software_code\Visual_Stdio_Code\WindowsForAgent\artifacts\GhostScreen-0.1.0\cli\GhostScreen.Cli.exe shot --hwnd $h --out <repo>\screenshots\invisible-window-capture.png --confirm
```
锛堝啀鎸夐渶閲嶅仛瀵规瘮鍚堟垚鍥俱€傦級
