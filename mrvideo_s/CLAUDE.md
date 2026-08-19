# CLAUDE.md — video-editor/mrvideo_s

「影片先生」的**課程教學版**（子資料夾，非獨立 git 儲存庫——commit 在 `video-editor` 這個 repo 裡）。功能與根目錄的一般版完全相同，唯一差異：**整個工具需先輸入「課程授權序號」並按「確認」驗證通過，才能使用**（不是只鎖某一個功能——這點與 `sbir-generator/sbir-gen-s`、`icap-generator/icap_s` 只鎖「AI 優化」不同，是應使用者要求的設計）。

## 架構

- `index.html`／`css/style.css`／`js/*.js` — 直接複製自根目錄版本再疊加修改，**不是共用檔案**；根目錄版本有 bug 修正或功能異動時，要手動同步套用到這裡（目前沒有自動化同步機制）。九個 VE 模組（`util/state/db/media/preview/timeline/panels/export/main`）在授權閘門這件事上未經修改，唯一新增檔案是 `js/license-gate.js`；**`js/export.js`／`js/media.js`／`js/panels.js` 會隨根目錄版本的功能異動而更新**（2026-07-26 同步套用了「附加匯出 .srt／.mp3」與「🤖 語音轉字幕」兩個功能，見下方），做法是直接把根目錄版本的這幾支檔案複製過來覆蓋（兩邊內容應保持逐位元組相同），不是重新實作一份；`index.html` 的對應 HTML 片段（匯出對話框勾選框、文字面板的語音轉字幕按鈕、lamejs CDN `<script>`）則是手動比對加入的，因為兩邊 `index.html` 整體不同檔（含閘門標記）。
- **序號閘門是獨立運作的全螢幕遮罩，不掛在 `window.VE` 命名空間下**：`index.html` 一開頭（`#app` 之前）就是 `#licenseGate` 全螢幕遮罩，預設顯示、驗證通過才加上 `.hidden`。VE 的九個模組仍會在遮罩後方正常初始化（載入專案、還原素材等），只是使用者被遮罩擋住看不到、點不到——這樣不用改動任何 VE 程式碼即可達成「整個工具都要序號」的效果。
- `js/license-gate.js`：`checkLicense()`／`runCheck()`／`unlock()`／`lock()`，回傳值正規化成 `{valid, reason, message?, expiresAt?}`。驗證通過會隱藏 `#licenseGate` 並在頁尾 `#gateStatusMini` 顯示剩餘天數；**背景每 20 分鐘靜默重新驗證一次**（`setInterval`），序號到期時會自動移除 `.hidden`、重新鎖定畫面（編輯到一半的內容仍保留在瀏覽器 state/localStorage 裡，不會被清掉，只是畫面被擋住）。
- `localStorage` 用獨立 key `mrvideoSSerial` 存序號，與根目錄版本共用的 `video-editor-project-v1`／`video-editor-ui-v1` 不衝突（**注意**：mrvideo_s 與根目錄版本若在同一個瀏覽器 origin 下開啟，專案資料 key 是共用的——若未來要讓兩者的剪輯內容互相獨立，需要另外評估是否要改 key 或改用不同 port/origin）。
- `Code.gs` — 部署到 Google Sheet 的 Apps Script 原始碼：`doPost` 只做序號驗證＋首次自動啟用，`doGet` 供部署後測試。**這不是這個資料夾裡的檔案在跑**，是使用者手動複製貼到 Google Sheet 的「擴充功能 → Apps Script」編輯器裡部署成 Web App，取得網址後回填到 `js/license-gate.js` 的 `LICENSE_CHECK_URL`。部署步驟見 `SETUP-授權伺服器設定.md`。
- 綁定的 Google Sheet：<https://docs.google.com/spreadsheets/d/1hVluEpy_0RgVUXGWj72o01mGplPQVqNRiNGJCstBREY/edit>（使用者既有的任務追蹤表，重複使用「序號」「開始日期」「結束日期」欄位；`Code.gs` 用表頭文字比對欄位、不依賴欄位順序，不會動到表裡其他欄位）。
- CORS 細節：`checkLicense()` 呼叫 `LICENSE_CHECK_URL` 時**刻意不設自訂 Content-Type**（讓瀏覽器預設用 `text/plain`），避免觸發 Apps Script 不支援的 CORS 預檢（OPTIONS）請求。
- 部署前 `LICENSE_CHECK_URL` 為空字串，序號驗證會 fail-closed 顯示「尚未設定授權伺服器網址」並保持鎖定畫面，不會誤放行。
- `manual.html` — 複製自根目錄版本，新增「課程授權序號」一節（含 TOC 連結）、調整快速開始步驟一、補充相關常見問題；其餘內容與根目錄版本相同，**根目錄版本內容更新時要手動同步套用**（含創作者經歷等共用段落，也與 `sbir-generator`／`icap-generator`／`phoenix-loan-generator` 的 manual.html 共用同一份創作者介紹，更新其中一邊時同步其餘）。

## 部署狀態

**已完成部署（2026-07-26）**。`js/license-gate.js` 的 `LICENSE_CHECK_URL` 已填入實際部署網址：`https://script.google.com/macros/s/AKfycbzcaiXxjd8ENqd5aXLqX2Z_ZIhTUlHuyKIJKzyz43DnK1Yu1tn-N50cvuNKhz24RSEA/exec`。已用 doGet 健康檢查、doPost（Node `fetch()`，非 curl）對既有序號 `k9T2mP8x` 驗證通過，並用 Playwright 對真實網址跑過一次瀏覽器端到端流程，確認鎖定畫面在驗證通過後正確隱藏。Google Sheet 裡已有一組測試序號 `k9T2mP8x`（有效期 2026/7/23–2026/11/23，與其他教學版共用的測試序號相同）可用於之後的複測。

**使用期限已改為 12 個月**（2026-07-26，原為 4 個月）：本地 `Code.gs`／`index.html`／`manual.html`／`SETUP-授權伺服器設定.md` 已全部同步改字。**但這只改了本地檔案**——Apps Script 是使用者手動貼上部署的，本地 `Code.gs` 改動不會自動同步到已部署的雲端腳本，需要使用者回到 Apps Script 編輯器貼上新版 `Code.gs`、存檔，再「部署 → 管理部署作業 → 編輯 → 新版本 → 部署」一次（部署網址不變，不需要再改前端）。**已啟用過的序號（例如測試序號 `k9T2mP8x`，結束日期已寫死在 Sheet 的 2026/11/23）不會回溯套用新期限**——因為 `checkOrActivate()` 只在結束日期欄位是空的時候才會依 `VALID_AMOUNT` 計算，已有值就直接採用；若要讓既有序號也套用 12 個月，需手動去 Sheet 把該列「結束日期」清空（下次驗證會依開始日期重新算成 12 個月後）或直接手動改成想要的日期。

## 頂部跑馬燈（2026-07-30 新增）

跟根目錄版本（見 `../CLAUDE.md`）同一套邏輯，直接複製過來套用：`#marqueeBar` 是 `#app` 裡第一個 flex 子項，跟 `#licenseGate` 全螢幕鎖定遮罩、下方 VE 命名空間都無關的獨立 `<script>`。**刻意選擇跟共用跑馬燈端點直接呼叫，沒有整合進 `js/license-gate.js` 的序號驗證流程**——本工具的序號驗證是打自己獨立的 Apps Script（見上方「部署狀態」），跟這份共用跑馬燈 Google Sheet 完全是两回事；`localStorage` key `ve_marquee`，每 20 分鐘重抓一次。**視覺上的差異**：因為 `#marqueeBar` 在 `#app` 內部（非 `position:fixed`），鎖定畫面顯示時會被 `#licenseGate` 遮罩擋住看不到，序號驗證通過、遮罩加上 `.hidden` 後才會顯示——這跟 `AIvideo_studio`（`z-index` 蓋過遮罩、鎖定畫面也看得到）的做法不同，是刻意的簡化，避免去改動這裡自己獨立的 `Code.gs`／重新部署。改跑馬燈內容直接編輯共用 Sheet 即可：<https://docs.google.com/spreadsheets/d/1sSBXW2dAc-4u0j21Q72MzNEBIhDccShhr1iJcAdG0UE/edit>。**改完後記得重新執行 `影片先生_V1/build.ps1` 才會反映到安裝包裡**（已於本次新增時重建過一次，67KB）。

## 匯出浮水印與加入主畫面（PWA，2026-08-19 新增）

- **匯出浮水印**：跟 `phoenix-loan-limit` 的浮水印精神一致（防止教學版產出被拿去販售/公開發布卻看不出來源），但落地方式不同——本工具沒有文件預覽/列印/Word 匯出，改成**燒錄在匯出的影片畫面上**。做法：`preview.js` 新增 `drawExportWatermark(W,H)`，畫在畫布右下角（半透明白字「影片先生 課程教學版」+ 黑色描邊），只在 `VE.drawFrame()` 尾端、`if (VE.exporting)` 成立時才呼叫——`VE.exporting` 是既有的匯出旗標（`export.js` 的 `fastExport()`/`realtimeExport()` 開始時會設成 `true`），因此**快速匯出（WebCodecs 逐幀 `VE.drawFrame(t)`）與即時錄製（`canvas.captureStream()` 擷取同一份 `drawFrame` 的 rAF 畫面）兩條匯出路徑會自動共用同一份浮水印邏輯**，不需要分別處理；一般編輯時的預覽畫布因為 `VE.exporting` 是 `false` 不會顯示浮水印，不影響操作視覺。已用 Playwright 對 `VE.getCanvas()` 做像素級驗證：`VE.exporting=true` 前後右下角區域像素總和有明顯差異、切回 `false` 後完全還原成跟切換前一致，證明浮水印只在匯出時出現、且不會殘留。
- **加入主畫面（PWA）**：`manifest.json`＋`service-worker.js`（network-first＋同源快取備援，只快取同源請求——CDN 的 mp4-muxer/lamejs 跨網域請求會被 `if (url.origin !== location.origin) return;` 略過，不受影響）＋`icons/`（192／512／maskable-512／apple-touch-icon 四種尺寸，Pillow 畫深色圓角方塊＋青色 `#38bdf8` 背景＋深色「影」字，跟本工具介面配色一致，`msjhbd.ttc` 粗體）。`<head>` 補齊 `manifest` link／`theme-color`／`apple-touch-icon`／`mobile-web-app-capable`＋`apple-mobile-web-app-capable`（兩個都要，只寫一個 Chrome 會噴 deprecation warning）／`apple-mobile-web-app-status-bar-style`／`apple-mobile-web-app-title`。頁尾新增「📲 加入主畫面」按鈕（`#installBtn`），安裝邏輯是獨立 `<script>` 放在 `js/main.js` 之後（**沿用 `phoenix-loan-limit` 已記過的教訓**：腳本必須放在按鈕元素之後才能 `getElementById` 抓到），iOS/macOS Safari 偵測、`beforeinstallprompt`/`appinstalled`、找不到 `deferredPrompt` 時的提示訊息**直接重用既有的 `VE.toast()`**（不像 `phoenix-loan-limit` 額外寫一個獨立 `notify()`，因為本工具的 `#toast` 元素與 `VE.toast()` 已經是現成的、且此腳本放在 `main.js` 之後保證 `window.VE` 已定義）。已用 Playwright 驗證：`manifest` link 可正常解析、`navigator.serviceWorker.getRegistration()` 狀態為 `activated`、`#installBtn` 存在。
- **已知限制（重要）**：本工具的桌面版安裝程式（`影片先生_V1/`）是**純靜態 `file://` 捷徑**（解壓 zip＋建 `.url` 指向 `file:///.../index.html`），跟 `phoenix-loan-limit` 的 exe（`launcher.py` 會在 `127.0.0.1:8778` 起一個真的本機 HTTP 伺服器）不同——**Service Worker 在 `file://` 協定下無法註冊**，瀏覽器規範限制，不是程式碼問題。也就是說：**「加入主畫面」功能只有在透過真正的 http(s) 來源開啟時才會生效**（例如本機 `python -m http.server` 或 Preview MCP 起的伺服器；未來若架站部署也會生效），透過桌面版 exe 的 `.url` 捷徑（`file://`）開啟時，點擊「加入主畫面」只會顯示 fallback 提示訊息（因為 `beforeinstallprompt` 事件不會觸發），不會噴錯，但實際上裝不起來。若要讓桌面版也能真正安裝，需要把 `影片先生_V1/` 的安裝程式改成比照 `phoenix-loan-limit`／`sbir-gen-s`／`icap_s` 那樣改用 Python 本機伺服器架構（目前尚未做這個改動，屬於較大的架構變更，需要另外評估是否要做）。

## 一鍵安裝程式（影片先生_V1/）

與 `video-editor/MrVideo/`（根目錄一般版的安裝程式）同一套做法，但**不是共用檔案、獨立一份**：`影片先生_V1/Installer.cs`＋`build.ps1`，編譯輸出 `影片先生課程教學版安裝程式.exe`。與根目錄版安裝程式的關鍵差異：

- `appName` 是 `"影片先生課程教學版"`（根目錄版是 `"影片先生"`），安裝目錄＝`%LOCALAPPDATA%\影片先生課程教學版`，桌面捷徑也用這個名稱——**兩個版本可以同時安裝在同一台電腦，不會互相覆蓋**。
- 這是**單純的靜態網頁安裝程式**（解壓 zip＋建 .url 捷徑指向 `file://index.html`），不像 `sbir-generator`／`icap-generator`／`phoenix-loan-generator` 的教學版 exe 那樣跑本機 Python HTTP 伺服器——因為 mrvideo_s 是純前端、無 fetch 相依（mp4-muxer／lamejs 皆走絕對網址 CDN），`file://` 下可正常運作，不需要伺服器。
- 打包內容**只有學員需要的檔案**：`index.html`／`manual.html`／`css/`／`js/`——**不包含 `Code.gs`／`SETUP-授權伺服器設定.md`**（那是老師專用的後端部署文件，不該出現在學員安裝包裡）。
- `build.ps1` 必須維持純 ASCII（同根目錄版限制），CJK 檔名／資料夾名一律用 `[char]0x____` code point 組字串產生，不可在檔案裡直接打中文字元。
- 安裝完成對話框額外提醒「使用前需輸入課程講師提供的課程授權序號並驗證通過」。

重建指令：`powershell -ExecutionPolicy Bypass -File "mrvideo_s\影片先生_V1\build.ps1"`。**修改 `index.html`／`css`／`js`／`manual.html` 後要重新執行這個指令才會反映到安裝包裡**，安裝程式本身不會自動更新。（2026-07-26 已重建三次：「附加匯出 .srt／.mp3」→「🤖 語音轉字幕」（OpenAI 版）→ 改用 Gemini＋API 金鑰搬到「⚙️設定」分頁，目前 66KB。）

**已知限制**：這個編譯出的 GUI exe（WinForms `MessageBox`）在本 Claude Code 沙箱工具環境裡無法直接執行測試（`Access is denied`，即使 `dangerouslyDisableSandbox:true` 仍然如此）——已確認不是編譯失敗（`xxd`／`file` 驗證過是合法的 PE32 .NET GUI 執行檔，與根目錄版一樣的編譯方式），推測是這個工具環境沒有可互動的視窗桌面（Window Station）可以顯示 `MessageBox`，而非執行檔本身有問題。**需要使用者自己在真正的桌面環境雙擊測試**才能確認安裝流程與桌面捷徑正常運作。

## 指令

無建置/測試指令。修改 `index.html`／`js/*.js` 後直接用瀏覽器開啟驗證；`node --check js/*.js` 檢查語法。若要驗證授權序號檢查邏輯，需先照 `SETUP-授權伺服器設定.md` 部署好 Apps Script 並回填 `LICENSE_CHECK_URL`，否則會顯示「尚未設定授權伺服器網址」的 fail-closed 錯誤訊息並停留在鎖定畫面。
