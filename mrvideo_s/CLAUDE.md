# CLAUDE.md — video-editor/mrvideo_s

「影片先生」的**課程教學版**（子資料夾，非獨立 git 儲存庫——commit 在 `video-editor` 這個 repo 裡）。功能與根目錄的一般版完全相同，差異：**「🤖 語音轉字幕」需先在頂部輸入「課程授權序號」並驗證通過才能使用，其餘功能（剪輯、匯出等）不受影響、永久可用**。

**2026-08-19 架構變更（重要）**：這個工具原本是「鎖整個工具」（全螢幕遮罩，驗證通過才放行），這次使用者要求改成跟 `sbir-generator/sbir-gen-s`、`icap-generator/icap_s` 一樣**只鎖單一 AI 功能**的模式——序號輸入從全螢幕遮罩移到頂部 banner 列，其他功能完全開放使用。同時語音轉字幕從只支援 Gemini 改成可選 **Gemini 或 OpenAI Whisper**（Claude 目前 API 不支援音訊輸入、OpenRouter 各模型音訊支援狀況不一，故不提供這兩個選項）。以下「架構」小節已依新版本改寫；舊版全螢幕遮罩的做法只留在 git 歷史裡。

## 架構

- `index.html`／`css/style.css`／`js/*.js` — 直接複製自根目錄版本再疊加修改，**不是共用檔案**；根目錄版本有 bug 修正或功能異動時，要手動同步套用到這裡（目前沒有自動化同步機制）。九個 VE 模組（`util/state/db/media/preview/timeline/panels/export/main`）本身未經修改；`js/license-gate.js` 是唯一新增檔案；**`js/export.js`／`js/media.js`／`js/panels.js` 會隨根目錄版本的功能異動而更新**（做法是直接把根目錄版本的這幾支檔案複製過來覆蓋，不是重新實作一份——但語音轉字幕的 provider 選擇＋序號驗證整合是本工具獨有，根目錄版本沒有，同步時要注意別覆蓋掉這段）；`index.html` 的對應 HTML 片段則是手動比對加入的，因為兩邊 `index.html` 整體不同檔。
- **序號列是頂部 banner（`#licenseBar`），不是全螢幕遮罩**：位於 `#app` 內、`#marqueeBar` 之前，跟 `window.VE` 命名空間平行運作（掛 `VE.runLicenseCheck` 供其他模組呼叫，但不影響 VE 本身初始化流程）。頁面載入時若 `localStorage` 已存序號會自動靜默驗證一次顯示剩餘天數，**不會擋住任何操作**——使用者一開始就能剪輯、匯出，只有按下「🤖 辨識全片講話並生成字幕」時才會擋。
- `js/license-gate.js`：`checkLicense()` 打 Apps Script；`VE.runLicenseCheck(opts)` 是對外的統一入口，回傳正規化 `{valid, reason, message?, expiresAt?, label}`（`label` 是已組好的中文提示文字，呼叫端不用自己查 `REASON_LABEL`）。**沒有背景定時重新驗證**（拿掉了舊版「每 20 分鐘 setInterval」的機制，因為現在不是全螢幕鎖定畫面，沒有「重新鎖住」這個概念）——改成**每次使用者按下「🤖 辨識全片講話並生成字幕」都會即時呼叫 `VE.runLicenseCheck()` 重新驗證**（`js/panels.js` 的 ASR 按鈕 handler），確保序號逾期後即使先前驗證過也無法再用該功能，這點跟 `phoenix-loan-limit` 的「AI 優化每次都重新驗證、不做本機快取信任」設計原則一致。
- `localStorage` 用獨立 key `mrvideoSSerial` 存序號，與根目錄版本共用的 `video-editor-project-v1`／`video-editor-ui-v1` 不衝突（**注意**：mrvideo_s 與根目錄版本若在同一個瀏覽器 origin 下開啟，專案資料 key 是共用的——若未來要讓兩者的剪輯內容互相獨立，需要另外評估是否要改 key 或改用不同 port/origin）。
- `Code.gs` — 部署到 Google Sheet 的 Apps Script 原始碼：`doPost` 只做序號驗證＋首次自動啟用，`doGet` 供部署後測試。**沿用舊版同一支已部署的 Apps Script，這次架構變更完全不需要改動或重新部署 Code.gs**——`doPost` 回傳的「這個序號有效嗎」本來就跟「鎖整個工具還是鎖單一功能」無關，前端怎麼用這個驗證結果才是這次改的地方。這不是這個資料夾裡的檔案在跑，是使用者手動複製貼到 Google Sheet 的「擴充功能 → Apps Script」編輯器裡部署成 Web App，取得網址後回填到 `js/license-gate.js` 的 `LICENSE_CHECK_URL`。部署步驟見 `SETUP-授權伺服器設定.md`。
- 綁定的 Google Sheet：<https://docs.google.com/spreadsheets/d/1hVluEpy_0RgVUXGWj72o01mGplPQVqNRiNGJCstBREY/edit>（使用者既有的任務追蹤表，重複使用「序號」「開始日期」「結束日期」欄位；`Code.gs` 用表頭文字比對欄位、不依賴欄位順序，不會動到表裡其他欄位）。
- CORS 細節：`checkLicense()` 呼叫 `LICENSE_CHECK_URL` 時**刻意不設自訂 Content-Type**（讓瀏覽器預設用 `text/plain`），避免觸發 Apps Script 不支援的 CORS 預檢（OPTIONS）請求。
- 部署前 `LICENSE_CHECK_URL` 為空字串，`checkLicense()` 會 fail-closed 丟出「尚未設定授權伺服器網址」，`VE.runLicenseCheck()` 據此回傳 `valid:false`，語音轉字幕功能會被擋下（不會誤放行），但其他功能仍正常可用。
- **語音轉字幕金鑰／服務商設定**（`js/panels.js` 的 `VE.initPanels()` 內）：左側「⚙️設定」分頁新增 `#asrProvider` 下拉選單（`gemini`/`openai`），依選擇切換顯示 `#asrApiKeyGemini` 或 `#asrApiKeyOpenai` 兩個獨立金鑰輸入框（`.hidden` class 切換），各自存 `localStorage` key `video-editor-gemini-key`／`video-editor-openai-key`，服務商選擇存 `video-editor-asr-provider`。**金鑰仍是學員自備（bring-your-own-key），沒有走 proxy 代打**——這點跟 `phoenix-loan-limit` 不同，是這次確認過的設計決定。`js/export.js` 的 `VE.transcribeSpeech(provider, apiKey, onProgress)` 依 `provider` 分派到 `transcribeWithGemini()`（沿用舊版邏輯，JSON 陣列＋自估時間戳記，上限 15MB）或 `transcribeWithOpenAI()`（新增，`POST /v1/audio/transcriptions`，`model:'whisper-1'`＋`response_format:'verbose_json'`，直接拿 `segments` 陣列的原生對齊時間戳記，不用自己 regex 解析 JSON，上限 25MB 因為是二進位 multipart 直傳、沒有 base64 膨脹）。
- `manual.html` — 複製自根目錄版本，新增「課程授權序號」一節（含 TOC 連結）、調整快速開始步驟一、補充相關常見問題；其餘內容與根目錄版本相同，**根目錄版本內容更新時要手動同步套用**（含創作者經歷等共用段落，也與 `sbir-generator`／`icap-generator`／`phoenix-loan-generator` 的 manual.html 共用同一份創作者介紹，更新其中一邊時同步其餘）。**2026-08-19 架構變更後尚未同步更新 manual.html**——內容仍描述舊版「整個工具需先驗證序號」的說法，待補。

## 部署狀態

**已完成部署（2026-07-26，2026-08-19 架構改版後沿用同一支已部署 Apps Script，未重新部署）**。`js/license-gate.js` 的 `LICENSE_CHECK_URL` 已填入實際部署網址：`https://script.google.com/macros/s/AKfycbzcaiXxjd8ENqd5aXLqX2Z_ZIhTUlHuyKIJKzyz43DnK1Yu1tn-N50cvuNKhz24RSEA/exec`。已用 doGet 健康檢查、doPost（Node `fetch()`，非 curl）驗證通過。2026-08-19 用 Playwright 對真實網址重新跑過一次瀏覽器端到端流程：頂部序號列可正確顯示既有 localStorage 序號的驗證結果（含「查無此序號」的失敗狀態）、清空序號後按「🤖 辨識全片講話並生成字幕」會被正確擋下並顯示「請輸入課程授權序號」、序號驗證通過時 provider/apiKey 會正確傳給 `VE.transcribeSpeech()`。**注意：測試序號 `k9T2mP8x`（原記錄有效期 2026/7/23–2026/11/23）這次重測時 Sheet 回傳 `serial_not_found`**，可能是 Sheet 資料後續被異動過，複測前建議先用 doGet／doPost 或直接查 Sheet 確認目前有哪些有效測試序號，不要假設這組舊序號還在。

**使用期限已改為 12 個月**（2026-07-26，原為 4 個月）：本地 `Code.gs`／`index.html`／`manual.html`／`SETUP-授權伺服器設定.md` 已全部同步改字。**但這只改了本地檔案**——Apps Script 是使用者手動貼上部署的，本地 `Code.gs` 改動不會自動同步到已部署的雲端腳本，需要使用者回到 Apps Script 編輯器貼上新版 `Code.gs`、存檔，再「部署 → 管理部署作業 → 編輯 → 新版本 → 部署」一次（部署網址不變，不需要再改前端）。**已啟用過的序號（例如測試序號 `k9T2mP8x`，結束日期已寫死在 Sheet 的 2026/11/23）不會回溯套用新期限**——因為 `checkOrActivate()` 只在結束日期欄位是空的時候才會依 `VALID_AMOUNT` 計算，已有值就直接採用；若要讓既有序號也套用 12 個月，需手動去 Sheet 把該列「結束日期」清空（下次驗證會依開始日期重新算成 12 個月後）或直接手動改成想要的日期。

## 頂部跑馬燈（2026-07-30 新增）

跟根目錄版本（見 `../CLAUDE.md`）同一套邏輯，直接複製過來套用：`#marqueeBar` 是 `#app` 裡第二個 flex 子項（第一個是 2026-08-19 新增的 `#licenseBar`），跟序號驗證、下方 VE 命名空間都無關的獨立 `<script>`。**刻意選擇跟共用跑馬燈端點直接呼叫，沒有整合進 `js/license-gate.js` 的序號驗證流程**——本工具的序號驗證是打自己獨立的 Apps Script（見上方「部署狀態」），跟這份共用跑馬燈 Google Sheet 完全是两回事；`localStorage` key `ve_marquee`，每 20 分鐘重抓一次。**2026-08-19 後：全螢幕鎖定遮罩已移除，跑馬燈跟頁面其他內容一樣一開始就看得到**，不再有「鎖定畫面時被擋住」的視覺差異（這點跟舊版行為不同，也跟 `AIvideo_studio` 趨於一致）。改跑馬燈內容直接編輯共用 Sheet 即可：<https://docs.google.com/spreadsheets/d/1sSBXW2dAc-4u0j21Q72MzNEBIhDccShhr1iJcAdG0UE/edit>。**改完後記得重新執行 `影片先生_V1/build.ps1` 才會反映到安裝包裡**。

## 匯出閃爍／黑屏修正（2026-08-19 新增，與根目錄版本同一套邏輯，同一天內修了三次）

跟根目錄版本一樣修正了 `export.js` 的 `seekVisualsTo()`：黑屏成因有兩層——① 片段剛匯入還沒讀過就直接匯出（先等 `loadedmetadata` 才 seek）；② **時間軸中後段才第一次出現的片段，來源檔案在那之前完全沒被瀏覽器碰過，冷啟動的 seek 可能遠比 700ms 慢**（使用者實測案例：匯出到 1:28 才黑屏，精確對應某片段第一次出現的時間點）。中途一度加了 `requestVideoFrameCallback` 想解決閃爍，後來用真實長 GOP 測試影片重新驗證證實這個方向是錯的且有害（已拿掉）。**最終做法**：新增 `preloadVideoElements()` 在匯出一開始就先觸發所有片段背景緩衝＋逾時大幅放寬（seeked 700→4000ms、loadedmetadata 2000→5000ms）。詳細的三次踩坑過程見 `../CLAUDE.md` 同名章節，這裡不重複。已用同一套嚴謹驗證（雙片段冷啟動交界情境、真實長 GOP 測試影片、ffmpeg 逐格量測色彩）重新確認這裡零黑幀零錯幀。

## 編輯預覽「按暫停鍵時會出現黑屏／往前移動時也會黑屏」修正（2026-08-19 新增，與根目錄版本同一套邏輯，同一天內修了兩次）

跟上面「匯出閃爍／黑屏」是不同的 bug，發生在編輯畫面即時預覽播放（`preview.js` 的 `syncMedia`/`VE.pause`/`VE.seek`），不是匯出流程。**第一次修正**（比照 `VE.seek()` 已有的「seek 完成後 `setTimeout(...,120)` 延遲補畫一次」套用到 `VE.pause()`）判斷方向對但不夠完整，使用者接著回報「還是會有黑屏，往前移動時也會」。**第二次修正（定案）**挖出兩個疊加根因：① 固定 120ms 延遲改成真正等待瀏覽器 `seeked` 事件（`syncMedia` 新增第三個選填參數 `waits`，配合 `drawGen` 世代編號避免舊等待蓋掉新畫面）；② **更關鍵**：原本 `syncMedia` 的觸發條件 `!el.seeking && ...` 導致「只要 video 元素正在 seek 中，這次呼叫完全不處理」——拖曳時間軸連續呼叫 `VE.seek()` 時，第一個 seek 還沒完成，後面幾次呼叫的新目標全部被擋掉、連 `el.currentTime` 都沒更新，畫面卡在中途某個目標，這才是「往前移動時也會黑屏」的真正成因。改用 `entry.seekTarget` 追蹤目前真正在等待的目標（而非不可靠的 `el.currentTime`），只要新目標差距超過容差就重新指定，不需等前一個 seek 先完成。已用 Playwright 驗證三種情境（暫停時漂移、快速連續 seek 模擬拖曳、冷片段往前跳），皆通過。詳細成因、踩坑過程與驗證方式見 `../CLAUDE.md` 同名章節，這裡不重複。

## 匯入影片時長自動修正、片段縮放上限提高（2026-08-19 新增，與根目錄版本同一套邏輯）

跟根目錄版本一樣套用了「匯入影片時長自動修正」（`media.js` 的 `detectFrozenTail()`，偵測並修正部分影片容器時長中繼資料不準確導致的「顯示時長比實際內容長」問題，詳見 `../CLAUDE.md` 同名章節）與「片段縮放上限從 1000%／20 倍提高到 5000%／50 倍」（`panels.js` 的 `KF_PROPS`＋`preview.js` 拖曳縮放/滾輪縮放的 `VE.clamp` 上限），兩邊是逐位元組相同的邏輯，這裡不重複細節。

## 完整預覽／劇院模式（2026-08-19 新增，與根目錄版本同一套邏輯）

跟根目錄版本一樣新增頂部「🎬 完整預覽」按鈕（`#btnPreviewFull`）＋劇院模式（`#app.theater-mode` 隱藏側面板/時間軸，畫布放大從頭播放），詳細設計見 `../CLAUDE.md` 的「完整預覽／劇院模式」一節，這裡不重複。**唯一差異**：本工具頂部多了 `#licenseBar`（序號授權列），進入劇院模式時**不會**被隱藏（跟頂部工具列/跑馬燈一樣維持可見，只藏側面板與時間軸），已用 Playwright 驗證過。`manual.html` 已同步補上「🎬 完整預覽」小節（在「匯出影片」底下、「浮水印」小節之前）。

## 文字安全區域（2026-08-19 新增，與根目錄版本同一批邏輯）

`js/preview.js` 的 `drawText()` 跟根目錄版本一樣加了字幕安全區域自動斷行（左右各留畫布寬度 5%，含語音轉字幕自動生成的字幕在內），詳細設計與已知不完美之處見 `../CLAUDE.md` 的「文字安全區域」一節，這裡不重複——兩邊是逐位元組相同的邏輯，直接複製套用。已用 Playwright 對這裡的 `VE.getCanvas()` 重新驗證過一次（16:9／9:16 兩種畫布皆通過）。

## 匯出浮水印與加入主畫面（PWA，2026-08-19 新增）

- **匯出浮水印**：跟 `phoenix-loan-limit` 的浮水印精神一致（防止教學版產出被拿去販售/公開發布卻看不出來源），但落地方式不同——本工具沒有文件預覽/列印/Word 匯出，改成**燒錄在匯出的影片畫面上**。做法：`preview.js` 新增 `drawExportWatermark(W,H)`，只在 `VE.drawFrame()` 尾端、`if (VE.exporting)` 成立時才呼叫——`VE.exporting` 是既有的匯出旗標（`export.js` 的 `fastExport()`/`realtimeExport()` 開始時會設成 `true`），因此**快速匯出（WebCodecs 逐幀 `VE.drawFrame(t)`）與即時錄製（`canvas.captureStream()` 擷取同一份 `drawFrame` 的 rAF 畫面）兩條匯出路徑會自動共用同一份浮水印邏輯**，不需要分別處理；一般編輯時的預覽畫布因為 `VE.exporting` 是 `false` 不會顯示浮水印，不影響操作視覺。已用 Playwright 對 `VE.getCanvas()` 做像素級驗證：`VE.exporting=true` 前後右下角區域像素總和有明顯差異、切回 `false` 後完全還原成跟切換前一致，證明浮水印只在匯出時出現、且不會殘留。
  - **2026-08-19 同一天內第二次調整：浮水印從純文字改成「馬克老師AI」品牌 logo 圖片**（使用者提供角色插畫＋文字組合圖）。**圖片來源刻意重用 `資料儀表板/IPA_Kano/watermark-source.png`**（480×297，已去背/裁切/量化過），不是自己重新處理使用者這次貼的原圖——因為兩者是同一張圖（使用者提供的檔名跟 IPA_Kano CLAUDE.md 記錄的來源檔完全一致），工作區已有 `phoenix-loan-limit`／`IPA_Kano` 共用同一份處理過的版本，維持這個慣例避免同一張圖在不同專案各自處理出略有差異的版本。base64 直接內嵌成 `js/preview.js` 開頭的 `WATERMARK_LOGO_DATA_URI` 常數（約 15 萬字元，讓 `preview.js` 檔案體積大幅增加，屬預期行為）＋`var watermarkImg = new Image()` 預先載入。`drawExportWatermark()` 改用 `ctx.drawImage()`：寬度固定為畫布寬度 16%（依 `watermarkImg.naturalWidth/naturalHeight` 等比縮放）、右下角留 2% 邊距、`globalAlpha=0.85`（是可清楚辨識的品牌角標，不是低調底紋，故用較高透明度）；`watermarkImg.complete` 尚未真的載入完成時直接跳過不畫（data URI 通常同步/近乎同步解碼完成，但仍做這層保護避免極端情況擋住匯出）。**改水印圖片時**：先更新 `IPA_Kano/watermark-source.png`（若要共用調整），再用 Python 腳本讀圖轉 base64、對 `preview.js` 做字串取代（`re` 只匹配 `WATERMARK_LOGO_DATA_URI` 那一整行，不要用 Edit 工具手動編輯，避免把巨大字串整包載入對話上下文）。已用 Playwright 重新驗證：畫面像素邊界確認浮水印完全落在畫布內（`maxX<W`／`maxY<H`）、匯出旗標開關時浮水印正確出現/消失。
  - **2026-08-19 同一天內第三次調整：浮水印與課程授權序號掛鉤**（使用者要求「輸入序號時候，影片就不會有浮水印」）。做法比照「🤖 語音轉字幕」既有的即時驗證模式，不做本機快取信任：`export.js` 新增 `VE.exportWatermarkOff`（module-level 布林旗標，掛在 `VE` 命名空間讓 `preview.js` 讀得到）＋`refreshWatermarkStatus()`（呼叫既有的 `VE.runLicenseCheck({silent:true})`，把結果寫進旗標並更新匯出對話框裡的 `#wmStatus` 文字）。**兩個觸發時機**：① `openModal()`（按「⬆ 匯出影片」開啟對話框時）先跑一次讓使用者在按「開始匯出」前就看到目前狀態；② `startExport()`（按「開始匯出」時）**一定會重新等待一次全新的驗證結果才真正開始匯出**（`await refreshWatermarkStatus()` 效果的 `.then()`），不會沿用①的舊結果——避免使用者在對話框開著期間序號才輸入完成/驗證通過，卻因為用了①那次還沒驗證好的舊結果而誤判。`preview.js` 的判斷式從 `if (VE.exporting)` 改成 `if (VE.exporting && !VE.exportWatermarkOff)`。**踩坑處理**：`startExport()` 一開始就提前把 `VE.exporting = true`（原本是進到 `fastExport()`/`realtimeExport()` 內部才設），讓「確認課程授權序號中…」這段等待期間使用者按下「取消」也能被 `els.cancel` 既有的 `if (VE.exporting)` 分支正確攔截，否則會被誤判成「還沒開始匯出」只是單純隱藏對話框，導致驗證跑完後背景仍會偷偷繼續匯出。已用 Playwright 驗證：無序號時 `#wmStatus` 顯示「含浮水印」、`VE.exportWatermarkOff===false`；stub `VE.runLicenseCheck` 回傳有效序號後按「開始匯出」，`VE.exportWatermarkOff` 正確變 `true`、`#wmStatus` 顯示「✓ 已驗證...不含浮水印」，且此時 `VE.drawFrame()` 對右下角浮水印區域的像素掃描確認完全沒畫上去。`影片先生_V1/build.ps1` 已為此重建（182KB）；`manual.html`／`SETUP-授權伺服器設定.md` 已同步更新「浮水印」相關段落。
- **加入主畫面（PWA）**：`manifest.json`＋`service-worker.js`（network-first＋同源快取備援，只快取同源請求——CDN 的 mp4-muxer/lamejs 跨網域請求會被 `if (url.origin !== location.origin) return;` 略過，不受影響）＋`icons/`（192／512／maskable-512／apple-touch-icon 四種尺寸，Pillow 畫深色圓角方塊＋青色 `#38bdf8` 背景＋深色「影」字，跟本工具介面配色一致，`msjhbd.ttc` 粗體）。`<head>` 補齊 `manifest` link／`theme-color`／`apple-touch-icon`／`mobile-web-app-capable`＋`apple-mobile-web-app-capable`（兩個都要，只寫一個 Chrome 會噴 deprecation warning）／`apple-mobile-web-app-status-bar-style`／`apple-mobile-web-app-title`。頁尾新增「📲 加入主畫面」按鈕（`#installBtn`），安裝邏輯是獨立 `<script>` 放在 `js/main.js` 之後（**沿用 `phoenix-loan-limit` 已記過的教訓**：腳本必須放在按鈕元素之後才能 `getElementById` 抓到），iOS/macOS Safari 偵測、`beforeinstallprompt`/`appinstalled`、找不到 `deferredPrompt` 時的提示訊息**直接重用既有的 `VE.toast()`**（不像 `phoenix-loan-limit` 額外寫一個獨立 `notify()`，因為本工具的 `#toast` 元素與 `VE.toast()` 已經是現成的、且此腳本放在 `main.js` 之後保證 `window.VE` 已定義）。已用 Playwright 驗證：`manifest` link 可正常解析、`navigator.serviceWorker.getRegistration()` 狀態為 `activated`、`#installBtn` 存在。
- **已知限制（重要）**：本工具的桌面版安裝程式（`影片先生_V1/`）是**純靜態 `file://` 捷徑**（解壓 zip＋建 `.url` 指向 `file:///.../index.html`），跟 `phoenix-loan-limit` 的 exe（`launcher.py` 會在 `127.0.0.1:8778` 起一個真的本機 HTTP 伺服器）不同——**Service Worker 在 `file://` 協定下無法註冊**，瀏覽器規範限制，不是程式碼問題。也就是說：**「加入主畫面」功能只有在透過真正的 http(s) 來源開啟時才會生效**（例如本機 `python -m http.server` 或 Preview MCP 起的伺服器；未來若架站部署也會生效），透過桌面版 exe 的 `.url` 捷徑（`file://`）開啟時，點擊「加入主畫面」只會顯示 fallback 提示訊息（因為 `beforeinstallprompt` 事件不會觸發），不會噴錯，但實際上裝不起來。若要讓桌面版也能真正安裝，需要把 `影片先生_V1/` 的安裝程式改成比照 `phoenix-loan-limit`／`sbir-gen-s`／`icap_s` 那樣改用 Python 本機伺服器架構（目前尚未做這個改動，屬於較大的架構變更，需要另外評估是否要做）。**2026-08-19 這個限制間接被 GitHub Pages 解決了一半**：`https://m255525.github.io/video-editor/mrvideo_s/`（見根目錄 `../CLAUDE.md` 的「公開 GitHub repo」一節）是真正的 https 來源，Service Worker 在這裡可以正常註冊、「加入主畫面」也真的能用——但這只服務**透過網址使用**的學員，桌面版 exe 的 `file://` 限制本身沒有改變，仍是上述狀態。

## 軌道靜音誤把畫面也隱藏掉（2026-08-20 修正，與根目錄版本同一套邏輯）

跟根目錄版本一樣，軌道標頭 🔇 按鈕原本「靜音同時隱藏整軌」，對影片軌來說會讓使用者以為「靜音」把畫面也弄不見了。拆開成「靜音只影響聲音，不影響畫面」：`js/preview.js` 的 `VE.drawFrame()` 與 `js/export.js` 的 `seekVisualsTo()` 都拿掉 `|| tr.muted` 這個跳過繪製的條件，只保留 `tr.type === 'audio'`；`js/timeline.js` 按鈕 tooltip 與 `manual.html` 說明同步更新。詳細成因與驗證方式見 `../CLAUDE.md` 同名章節，這裡不重複。`index.html` 的 `?v=` 破快取版號已一併調高。

## 分離音訊（2026-08-20 新增，與根目錄版本同一套邏輯）

跟根目錄版本一樣，選取影片片段時右側「音訊」區塊多了「🎵 分離音訊到獨立音軌」按鈕，`VE.detachAudio()` 把聲音複製成獨立音訊片段放到音訊軌、原影片片段自動靜音。與序號授權／浮水印無關，不受課程授權序號驗證狀態影響，永久可用。詳細設計與驗證方式見 `../CLAUDE.md` 同名章節，這裡不重複——`js/media.js`／`js/panels.js` 是逐位元組相同的改動。

## 訪客次數計數器（2026-08-19 新增）

頁尾比照 `SocialPost`／`phoenix-loan-limit`／`IPA_Kano` 的既有做法，加了一個 `visitor-badge.laobi.icu` 的 SVG badge：`<img src="https://visitor-badge.laobi.icu/badge?page_id=m255525.mrvideos">`，免金鑰免後端，純前端 `<img>` 嵌入即可，跟工作區其他已上線工具用同一個第三方服務、各自用不同的 `page_id`（本專案取 `m255525.mrvideos`）區分計數。**只加在 `mrvideo_s`，根目錄一般版沒有加**——因為 GitHub Pages 只公開發布 `mrvideo_s`（見 `../CLAUDE.md` 的「公開 GitHub repo」一節），根目錄版目前沒有對外公開網址，加了訪客計數也只會計入本機測試次數，沒有意義。位置放在頁尾「📲 加入主畫面」按鈕與「創作者：Mark Tsai」之間。已用 Playwright 對本機預覽伺服器驗證 `<img>` 確實插入、`src` 正確、圖片實際載入成功（`naturalWidth>0`）；桌面版安裝程式（`影片先生_V1/`）走 `file://` 協定開啟同樣能載入這個外部圖片（不受 Service Worker 限制影響，純 `<img>` 標籤沒有這層問題），已重新打包 exe 讓安裝內容跟 `index.html` 保持一致。

## 一鍵安裝程式（影片先生_V1/）

與 `video-editor/MrVideo/`（根目錄一般版的安裝程式）同一套做法，但**不是共用檔案、獨立一份**：`影片先生_V1/Installer.cs`＋`build.ps1`，編譯輸出 `影片先生課程教學版安裝程式.exe`。與根目錄版安裝程式的關鍵差異：

- `appName` 是 `"影片先生課程教學版"`（根目錄版是 `"影片先生"`），安裝目錄＝`%LOCALAPPDATA%\影片先生課程教學版`，桌面捷徑也用這個名稱——**兩個版本可以同時安裝在同一台電腦，不會互相覆蓋**。
- 這是**單純的靜態網頁安裝程式**（解壓 zip＋建 .url 捷徑指向 `file://index.html`），不像 `sbir-generator`／`icap-generator`／`phoenix-loan-generator` 的教學版 exe 那樣跑本機 Python HTTP 伺服器——因為 mrvideo_s 是純前端、無 fetch 相依（mp4-muxer／lamejs 皆走絕對網址 CDN），`file://` 下可正常運作，不需要伺服器。
- 打包內容**只有學員需要的檔案**：`index.html`／`manual.html`／`css/`／`js/`——**不包含 `Code.gs`／`SETUP-授權伺服器設定.md`**（那是老師專用的後端部署文件，不該出現在學員安裝包裡）。
- `build.ps1` 必須維持純 ASCII（同根目錄版限制），CJK 檔名／資料夾名一律用 `[char]0x____` code point 組字串產生，不可在檔案裡直接打中文字元。
- 安裝完成對話框提醒文字**已於 2026-08-19 更新**：舊文案「使用前需輸入課程講師提供的課程授權序號並驗證通過」改成「開啟後即可直接剪輯、匯出，不需要任何序號。僅『AI 語音轉字幕』功能需輸入課程講師提供的『課程授權序號』（畫面最上方）並驗證通過才能使用」，避免誤導學員以為整個工具都要序號才能開始剪輯。

重建指令：`powershell -ExecutionPolicy Bypass -File "mrvideo_s\影片先生_V1\build.ps1"`。**修改 `index.html`／`css`／`js`／`manual.html` 後要重新執行這個指令才會反映到安裝包裡**，安裝程式本身不會自動更新。**2026-08-19 已為序號架構改版＋浮水印/PWA 改動＋對話框文案重建過一次**（70KB）。

**已知限制**：這個編譯出的 GUI exe（WinForms `MessageBox`）在本 Claude Code 沙箱工具環境裡無法直接執行測試（`Access is denied`，即使 `dangerouslyDisableSandbox:true` 仍然如此）——已確認不是編譯失敗（`xxd`／`file` 驗證過是合法的 PE32 .NET GUI 執行檔，與根目錄版一樣的編譯方式），推測是這個工具環境沒有可互動的視窗桌面（Window Station）可以顯示 `MessageBox`，而非執行檔本身有問題。**需要使用者自己在真正的桌面環境雙擊測試**才能確認安裝流程與桌面捷徑正常運作。

## 指令

無建置/測試指令。修改 `index.html`／`js/*.js` 後直接用瀏覽器開啟驗證；`node --check js/*.js` 檢查語法。若要驗證授權序號檢查邏輯，需先照 `SETUP-授權伺服器設定.md` 部署好 Apps Script 並回填 `LICENSE_CHECK_URL`，否則頂部序號列會顯示「尚未設定授權伺服器網址」的 fail-closed 錯誤訊息、「🤖 語音轉字幕」功能會被擋下，但其餘功能不受影響（2026-08-19 起不再有全螢幕鎖定畫面）。
