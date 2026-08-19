# video-editor — 影片先生

**瀏覽器端影片編輯器**（產品名「影片先生」，創作者 Mark Tsai；頁尾與匯出視窗固定顯示「僅供教學、課程及個人使用」警語，勿移除）。純前端、無 build step、無框架、無外部相依；以 `file://` 開啟或任何靜態伺服器託管皆可（`.claude/launch.json` 已有 `video-editor` 設定，port 8766）。建議使用 Chrome / Edge。

**公開 GitHub repo（2026-08-19）**：<https://github.com/M255525/video-editor>。已啟用 GitHub Pages（`.github/workflows/deploy-pages.yml` 標準 Actions 部署，不用 legacy branch-source），線上網址：<https://m255525.github.io/video-editor/>。

**2026-08-19 當天內接續調整：改成只公開 `mrvideo_s/` 教學版，根目錄一般版下線（改回轉址頁）**。原本 `path:'.'` 會把整個 repo 根目錄（含一般版 `index.html`／`css`／`js`）都發布出去，使用者後來要求「取消保留一般版的公開頁面，只保留教學版」。做法：workflow 新增一個 build 步驟，先把 `mrvideo_s/` 學員需要的檔案（`index.html`／`manual.html`／`manifest.json`／`service-worker.js`／`css/`／`js/`／`icons/`——**不含** `Code.gs`／`SETUP-授權伺服器設定.md`／`影片先生_V1/` 這些老師專用或安裝包產物）複製進 `dist/mrvideo_s/`，根目錄 `dist/index.html` 放一個轉址到 `mrvideo_s/` 的極簡頁面（比照 `IPA_Kano` 既有的 `meta refresh`＋`location.replace()` 雙保險做法），`upload-pages-artifact` 改成上傳 `dist` 而非 `.`。**這只影響 Pages 公開的內容，repo 本身與根目錄的一般版原始檔完全沒有被刪除或修改**，本機開發／`MrVideo/` 安裝程式都不受影響，純粹是「對外發布範圍」變了。已用 curl／Playwright 驗證：根目錄 `/` 回 200 且內容是轉址頁、實際瀏覽會自動跳到 `/mrvideo_s/`；一般版專屬檔案路徑（如 `/css/style.css`、`/manual.html`）已變成 404，不再對外可見；`/mrvideo_s/` 仍正常運作，manifest／service worker 也正確載入生效。**意外的額外好處**：這次順便發現 PWA「加入主畫面」在這個 https 網址上是**真的能用的**（`navigator.serviceWorker.getRegistration()` 狀態為 `activated`）——不像 `mrvideo_s/CLAUDE.md` 先前記錄的「exe 走 file:// 無法註冊 Service Worker」那個已知限制，GitHub Pages 這個管道等於間接解決了那個限制，學員透過這個網址使用時可以真正把教學版加入主畫面。

## 架構

- **模組化 classic script**：所有 JS 掛在共用命名空間 `window.VE`，`index.html` 以固定順序載入（順序即依賴順序）：
  `util → state → db → media → preview → timeline → panels → export → main`
- **禁止 ES module `import`/`export`**——`file://` 下本機模組會被 CORS 擋下（同 ai-course-hub 的「資料即全域變數」結論，套用到程式邏輯）。CSS 拆為 `css/style.css`，script/link 標籤帶 `?v=` 破快取版號。

## 各檔職責

| 檔案 | 職責 |
|---|---|
| `js/util.js` | uid/clamp/fmtTime、變速曲線 `VE.CURVES`、關鍵影格內插 `VE.kfValue/kfSet/kfRemove`、toast |
| `js/state.js` | 資料模型（project/track/clip）、undo/redo（快照式）、localStorage 存讀（key `video-editor-project-v1`） |
| `js/db.js` | IndexedDB（`video-editor-db`/`blobs`）存素材二進位，重新整理後可還原 |
| `js/media.js` | 匯入（input/拖放）、metadata 探測與縮圖、素材庫 UI、隱藏 `<video>/<audio>` 元素池 `VE.clipEls`；`getOrCreateSubtitleTrack()`（找/建專用「字幕」疊加軌，SRT 匯入與語音轉字幕共用）、`VE.addTranscriptSegments(segments)`（把 `[{start,end,text}]` 生成文字片段塞進字幕軌） |
| `js/preview.js` | Canvas 2D 逐幀合成（濾鏡 `ctx.filter`、關鍵影格 transform、轉場、文字/貼圖）、rAF 播放時鐘、Web Audio 混音、預覽畫布拖曳移動；`drawText()` 有**字幕安全區域自動斷行**（2026-08-19 新增，見下方「文字安全區域」） |
| `js/timeline.js` | 多軌時間軸：渲染、拖曳/跨軌搬移、邊緣裁切、分割、吸附、sticky 尺規（只畫可視範圍，避開 canvas 寬度上限） |
| `js/panels.js` | 左側（文字預設/emoji 貼圖/濾鏡預設/轉場卡片/**⚙️設定**）＋右側屬性面板（變換+關鍵影格◆、變速、音訊、濾鏡滑桿、文字樣式）；「文字」面板的 SRT 匯入按鈕與**🤖 語音轉字幕**按鈕（呼叫 `VE.transcribeSpeech()` 再交給 `VE.addTranscriptSegments()`）——**API 金鑰輸入框放在「⚙️設定」分頁、按鈕與結果訊息留在「文字」分頁**（兩個 DOM 元素分屬不同 `.panel`，JS 用同一組 id 直接互相取值，不受目前顯示哪個分頁影響） |
| `js/export.js` | 雙模式匯出：優先 **WebCodecs 離線快速匯出**（逐幀 seek→合成→VideoEncoder H.264 + OfflineAudioContext 混音→AudioEncoder AAC/Opus + mp4-muxer 封裝，無需播放）；不支援時退回 MediaRecorder 即時錄製。mp4-muxer 走 jsdelivr CDN（index.html），離線/載入失敗自動退回即時錄製。**附加匯出（選用勾選框）**：同時輸出字幕 `.srt`（收集所有 `type:'text'` 片段依 `start` 排序，純字串組裝，不需額外套件）與音軌 `.mp3`（重用 `renderAudio()` 的 OfflineAudioContext 混音結果，餵給 lamejs 逐 1152-sample frame 編碼；lamejs 走 CDN，同樣離線/載入失敗只會讓該選項失敗、不影響影片本身匯出）。兩者都在 `finishDownload()` 觸發視訊下載後才附加執行，沒有可匯出內容（無文字片段／無音軌）時各自顯示 toast 略過，不會擋住主要的影片匯出。**`VE.transcribeSpeech(apiKey, onProgress)`**：語音轉字幕的核心，重用同一套 `renderAudio()`＋`encodeMP3Blob()` 混音管線把時間軸現有聲音編碼成 mp3 轉 base64，送 **Gemini**（`gemini-3.5-flash`，`generateContent` + `inline_data` 音訊 part，header `x-goog-api-key`）並在提示詞要求回傳含時間戳記的 JSON 陣列，用正規表示式從回應文字裡截出 `[...]` 再 `JSON.parse`，回傳 `[{start,end,text}]`；只負責「聲音變文字」，不碰時間軸狀態（新增片段的部分交給 `media.js` 的 `VE.addTranscriptSegments`）。金鑰存 localStorage（key `video-editor-gemini-key`），單檔上限 15MB（base64 會膨脹約 1.33 倍，故比 Whisper 版本的 25MB 門檻更保守）超過會丟錯誤訊息。**2026-07-26 由 OpenAI Whisper 改為 Gemini**（使用者指定），Gemini 的時間戳記是模型自行估算、精確度不如 Whisper 原生對齊，這是換供應商的已知取捨，manual.html 已加註提醒使用者手動核對時間點 |
| `js/main.js` | 啟動、頂部工具列、鍵盤快捷鍵 |

## 資料模型重點

- `project.tracks` 陣列順序＝時間軸顯示順序（上→下：overlay、畫中畫、主影片軌、audio）；**渲染時反向**（尾端先畫）。
- clip：`start/duration` 為時間軸秒數；`in` 為素材來源秒數；`sourceTime = in + curve(p) * duration * speed`。變速改變 `duration`（來源範圍不變）。
- 關鍵影格 `clip.keyframes[prop] = [{t,v}]`，`t` 相對片段起點；套用於 x/y/scale/rotation/opacity，線性內插。
- 轉場掛在片段**開頭**（`clip.transition`），與前一個緊鄰片段銜接（crossfade/fadeblack/wipe/slide）。
- 軌道數量是**動態的**：時間軸工具列「＋軌道」可加音訊/畫中畫/文字貼圖軌（音訊加最下、疊加軌加最上、畫中畫插在最上層影片軌前）；空的非主軌可從軌道標頭 ✕ 刪除；**拖曳軌道標頭可上下調整圖層順序**（timeline.js `startHeadDrag`，越過目標列中線才交換）。
- 片段軌道相容規則（timeline.js `compatibleTrack`）：audio→音訊軌；video/image→影片軌；**text/sticker→疊加軌或影片軌皆可**。
- SRT/VTT 字幕：`VE.importSRT(file)`（media.js）解析後生成文字片段，放進名為「字幕」的專用 overlay 軌（不存在則自動建立在最上層）；`importFiles` 會依副檔名自動路由。
- 預覽畫布互動：拖曳移動、右下角握把拖曳縮放、滾輪縮放（皆 keyframe-aware：該屬性有關鍵影格時寫入播放頭處的 KF，否則改靜態值）。
- 復原/重做按鈕有兩組（頂部工具列＋時間軸工具列），啟用狀態由 `VE.updateHistoryUI`（main.js）依 `VE.canUndo/canRedo` 同步。
- 拖放輔助：素材 dragstart 設 `VE.dragMedia` ＋ `body[data-drag-type]`（CSS 亮起相容軌道）；dragover 時顯示 `#dropGhost` 落點幽靈預覽（吸附後位置，重疊/不相容顯示紅色）。
- 面板可調大小：`.resizer`（rzLeft/rzRight/rzBottom，main.js `initResizers`）拖曳調整左右面板寬與時間軸高，配置存 localStorage key `video-editor-ui-v1`。
- 專案結構存 localStorage；素材 Blob 存 IndexedDB；素材遺失時顯示「素材離線」，重新匯入**同名檔案**會自動復活原 id。

## 頂部跑馬燈（2026-07-30 新增）

`#marqueeBar` 是 `#app`（`height:100vh` flex column）裡的第一個 flex 子項（非 `position:fixed`，避免蓋住 `#topbar`），內容跟 ai-video-studio 系列（主版／`AIvideo_studio` 教學版／`ppt-course-video`）**共用同一個授權伺服器**（`https://script.google.com/macros/s/AKfycbwKX0.../exec`）與同一份跑馬燈 Google Sheet（<https://docs.google.com/spreadsheets/d/1sSBXW2dAc-4u0j21Q72MzNEBIhDccShhr1iJcAdG0UE/edit>）。本專案（根目錄版）沒有序號登入機制，做法是頁面載入時直接 POST 空序號給該網址（`doPost` 不論序號有效與否都會附上 `marquee` 陣列），`localStorage` key `ve_marquee`，每 20 分鐘背景重抓一次；獨立 `<script>` 掛在 `<body>` 開頭、`#app` 裡最前面，跟下方 `VE` 命名空間模組完全無關。改跑馬燈內容直接編輯該份 Sheet 即可，不需要重新部署 Apps Script，四個工具會同時更新。**`mrvideo_s/` 教學版也已同步加上（2026-07-30）**：做法跟根目錄版完全一樣的直接呼叫，**沒有**改成跟 `AIvideo_studio` 一樣「夾帶在序號驗證回應裡」——`mrvideo_s` 有自己獨立的序號驗證 Apps Script（跟這份共用跑馬燈 Sheet 完全無關），改成夾帶做法要另外去改它自己的 `Code.gs` 並重新部署，權衡後選擇直接呼叫共用端點的簡單做法，兩者互不影響。差異只在版面：`mrvideo_s` 的 `#marqueeBar` 放在 `#licenseGate` 全螢幕鎖定遮罩**之後**、`#app` 內部最上方（不是 fixed 蓋在遮罩上面），所以鎖定畫面顯示時跑馬燈是被擋住的，序號驗證通過、遮罩隱藏後才會看到——這是刻意的簡化，不是遺漏。詳見 `mrvideo_s/CLAUDE.md`。

## 完整預覽／劇院模式（2026-08-19 新增）

使用者要求「匯出前想看『最終成品』的完整預覽」——中央畫布原本的即時預覽（▶播放/拖曳時間軸）雖然用的是同一套 `VE.drawFrame()` 合成引擎，但畫面小、又被左右面板與時間軸擠壓，不利於像看片一樣完整走一遍成品。做法：頂部工具列新增「🎬 完整預覽」按鈕（`#btnPreviewFull`，放在「新專案」與「⬆ 匯出影片」之間），`js/main.js` 的 `initTheaterMode()`：

- **進入**：`#app` 加上 `.theater-mode` class（CSS 用這個 class 把 `#left`／`#rzLeft`／`#right`／`#rzRight`／`#rzBottom`／`#bottom` 全部 `display:none`，`#center` 是 flex:1 會自動撐滿剩餘空間，畫布因此自然放大，不需要另外寫縮放邏輯）＋顯示 `#previewWrap` 右上角浮動的「✕ 結束完整預覽」按鈕（`#btnExitPreview`，`position:absolute`）＋`VE.seek(0)` 從頭開始＋`VE.play()`。時間軸是空的（`VE.projectDuration()<=0`）會直接 toast 提示、不進入。
- **退出**：按「✕ 結束完整預覽」、或鍵盤 `Esc`（`document` 層級的 keydown listener，只在 `.theater-mode` 存在時才處理，不會跟 `initKeyboard()` 既有的其他快捷鍵沖突——`Esc` 目前沒有被別的功能用掉）都會 `VE.pause()`＋移除 `.theater-mode`＋隱藏退出按鈕。
- **刻意保留可見的部分**：頂部工具列（含 Undo/Redo/匯出按鈕）與底部 `#transport`（播放/上一格/下一格/時間顯示）**不會**被隱藏，只藏「側面板＋時間軸」——因為這兩塊還是有用（可以隨時暫停、微調後再重新完整預覽一次），純粹想要沉浸式體驗才需要藏更多，目前沒有做到「真全螢幕」（Fullscreen API）那麼徹底，是刻意的範圍取捨。
- 播放到結尾會自然停在最後一幀（沿用 `VE.play()`/`step()` 既有的播放結束邏輯），不會自動退出劇院模式，使用者可以重播或手動離開。
- 已用 Playwright 端對端驗證：空時間軸擋下＋toast、進入後三個區塊確實隱藏且畫布變大、退出按鈕與 `Esc` 兩種離開方式都正確還原版面並暫停播放。`mrvideo_s` 教學版套用同一套邏輯（含頂部多了 `#licenseBar` 的情況，序號列不受影響維持可見）。

## 文字安全區域（2026-08-19 新增）

所有文字片段（含手動輸入與語音轉字幕／SRT 匯入自動生成的字幕）渲染時會自動斷行、確保**左右兩側各留畫布寬度 5% 的安全邊界**，不會超出畫布邊緣被裁切——這是使用者發現語音轉字幕生成的長句子會跑出畫面左右邊緣後提出的需求（原本要求「左右各留 2mm」，但畫布是像素單位、沒有實體毫米概念，跟使用者確認後改用「畫布寬度固定比例」的做法，比照影視業常見的「字幕安全區」慣例）。

- `preview.js` 的 `TEXT_SAFE_MARGIN_RATIO = 0.05`＋`wrapLineToWidth()`／`wrapText()`：逐字元貪婪斷行（中英文皆適用，不依賴空白字元分詞），只在原本手動換行 `\n` 產生的每一段落內部另外自動斷行，不會把使用者刻意分段的 `\n` 吃掉。
- **安全寬度會考慮片段目前的水平位置，不是單純取畫布總寬度**：`drawText()` 用 `centerX = W/2 + tr.x` 算出片段目前的水平中心點，再取「中心點到左邊界」與「中心點到右邊界」兩者較小值的兩倍當作可用寬度——這樣即使使用者把文字拖離畫布中央，斷行仍會依實際留白空間動態調整，不會算錯。
- 套用的字型大小是**片段當下的實際渲染大小**（`t.size * tr.scale`，已含變速/關鍵影格縮放），且 `ctx.font` 在斷行計算前就先設好，所以 `ctx.measureText()` 量到的寬度就是最終畫面上的實際寬度，斷行結果直接可信。
- **已知不完美之處**：`contentSize()`（供選取框與滑鼠命中測試用）仍用原本未斷行的量測邏輯，沒有跟著套用斷行——這只影響選取框視覺（框可能比實際換行後的文字寬），不影響實際渲染輸出的正確性，故先不處理，除非之後選取框誤差造成操作困擾再回來補。
- 已用 Playwright 對 canvas 像素做邊界驗證：16:9／9:16 兩種畫布、置中與偏移中心兩種片段位置，斷行後的文字像素邊界皆落在安全區域內。

## 匯出閃爍／黑屏修正（2026-08-19 新增；同一天內修了三次，第三次才是真正定案的做法）

使用者回報「輸出影片為什麼會閃爍 還有黑屏」。根因在快速匯出（`fastExport`）逐幀呼叫的 `seekVisualsTo(t)`：片段剛匯入、還沒在編輯畫面播放/拖曳過時，`VE.ensureClipEl(clip)` 建立的 `<video>` 元素 `readyState` 還是 0（`HAVE_NOTHING`）。舊版邏輯的判斷式是 `if (el.readyState >= 1 && ...)` 才會等待 seek，**readyState 不足 1 時完全不等、直接放行**，`drawFrame` 就會畫到完全沒資料的空畫面——最常出現在匯出片頭。**修法**：`readyState < 1` 時先等 `loadedmetadata`（2000ms 逾時保底）才繼續 seek，不再無條件放行。這個部分兩次修正都保留、是唯一確定必要的改動。

**第一次修正（後來證實方向錯誤，已還原）**：當初還懷疑「`seeked` 事件只保證跳轉完成、不保證畫面已解碼完可畫」也是閃爍成因，加了 `requestVideoFrameCallback`（rVFC）逐幀核對 `metadata.mediaTime` 是否對到目標時間才放行。**過程中先踩了一個坑**：第一版把逾時檢查寫在 rVFC 回呼「裡面」，一旦回呼鏈不再觸發，逾時永遠不會被檢查到，整個匯出卡死在「準備編碼器…」不動；改成獨立於回呼鏈之外、只設一次的 `setTimeout` 才解決那次的卡死。**但即使修好卡死問題，使用者仍回報「還是會有黑幕跟閃爍發生」**，回頭用更嚴謹的測試才發現 rVFC 這個方向本身就是錯的：

1. 用**近乎全關鍵影格的合成測試影片**（`MediaRecorder` 從 canvas 錄製）驗證時看起來沒問題，但**真實影片檔案通常是長 GOP 編碼**（關鍵影格間隔可能好幾秒），直接用 `ffmpeg` 產生一段「關鍵影格間隔 3 秒、4 段純色（紅/綠/藍/黃）各 2.5 秒、720p、加雜訊避免內容過度單純」的測試影片重新驗證，才發現 rVFC 在**同一個 `<video>` 元素被連續大量呼叫**（快速匯出逐幀 seek 正是這個模式）時明顯不穩定——`seeked` 都正常觸發，但接在後面的 rVFC 回呼常常整串不再觸發，導致等待邏輯經常吃滿逾時上限，**匯出速度被拖慢超過一個數量級**（實測一支 7.6 秒的片段預估要 121 秒）。
2. **更關鍵的發現**：直接測試「`seeked` 觸發後立刻（不等 rVFC）`drawImage`」，逐一比對抓到的畫面顏色跟該時間點該有的內容——**完全準確，12 個測試點（涵蓋非關鍵影格位置、快速連續 seek）全部正確**。這代表 `seeked` 本身在這個情境下就已經可靠，rVFC 這層額外驗證根本是多餘的，當初「seeked 不保證解碼完成」的假設沒有成立。

**最終定案（已回歸這個版本）**：`seekVisualsTo` 只留「等 `loadedmetadata`」＋「等 `seeked`」兩層，**完全拿掉 rVFC**，`seeked` 的逾時從 300ms 放寬到 700ms（長 GOP 素材 seek 到非關鍵影格偶爾需要往前解碼較多幀，比合成測試影片慢）。

- **已用 Playwright 端對端嚴格驗證，且這次用真實長 GOP 編碼的測試影片，不是取巧的合成影片**：用上述 ffmpeg 產生的 720p、關鍵影格間隔 3 秒的測試影片，**完全不經過編輯畫面播放/預覽**直接觸發真正的匯出流程，攔截 `URL.createObjectURL` 取得實際輸出的 MP4 存檔，再用 `ffmpeg` 以 10fps 抽取影格（77 個取樣點涵蓋全部 4 段色彩），逐格量測畫面色彩。結果：**零黑幀、零錯幀，77 個取樣點色彩全部乾淨精確對應應有的色彩序列**，且匯出速度恢復正常（同一支素材 <30 秒完成，而非 rVFC 版本的 121 秒預估）。根目錄版與 `mrvideo_s` 同步套用。

**第三次修正（真正定案）**：第二版部署後使用者又回報「還是黝黑屏，這次發生在1:28」——**這是一個關鍵的精確資訊**，不是「整支影片隨機出現」而是「某個特定時間點」，指向真正的成因：**時間軸中後段才第一次出現的片段，它的來源檔案在那之前完全沒有機會被瀏覽器碰過**，`seekVisualsTo` 逐幀 seek 到它時才第一次觸發載入，若該檔案較大（或載入環境較慢），從「完全沒碰過」到「seek 到深處並解碼出正確畫面」可能需要遠超過 700ms——第二次修正把 rVFC 的問題修好了，但沒處理到「冷啟動片段的 seek 本身可能就是慢」這件事，逾時到了只好放行、抓到還沒真的到位的畫面。

修法兩管齊下（`export.js`）：
1. **新增 `preloadVideoElements()`**：在 `fastExport()` 一開始（比 `preloadImages()` 更早，緊接在 `setStatus('準備編碼器…')` 之後）就先走一輪所有影片片段呼叫 `VE.ensureClipEl(clip)`，讓瀏覽器提早在背景開始緩衝每一個片段的來源檔案——不等待任何一個真的就緒，純粹是「越早觸發背景下載，等真的逐幀播到它時越有機會已經準備好」。後面音訊混音/編碼的這段時間也順便變成所有片段的暖身空檔。
2. **大幅放寬逾時**：`seeked` 等待從 700ms 加到 **4000ms**，`loadedmetadata` 等待從 2000ms 加到 **5000ms**——寧可讓真的異常的片段多等幾秒，也不要在資料還在載入途中就提早放行。因為這兩個逾時只在片段「第一次」被存取、且位置真的需要移動時才會觸發等待（`Math.abs(el.currentTime - st) <= 0.005` 已經在位置時會立刻跳過），同一片段內逐幀往前挪一點點的正常情況幾乎不受影響，只有冷啟動的那一次等待被拉長。
- **已用 Playwright 端對端驗證這個確切情境**：時間軸放兩個片段——A（0-3秒，720p，紅色系）、B（3-9秒，**1080p 較大檔案**，藍色系，**匯出前完全沒被存取過**），完全模擬「片段中後段才第一次出現」。用 `ffmpeg` 對輸出結果在交界前後 1 秒（2.5s-3.5s）以 20fps 密集抽樣（22 個取樣點），**零黑幀**，紅→藍轉換乾淨銳利、沒有任何過渡期的黑畫面。根目錄版與 `mrvideo_s` 同步套用。
- **教訓**：驗證「畫面正確性」這類 bug 時，測試素材要盡量貼近真實使用情境（真實編碼結構，不是圖方便用近乎全關鍵影格的合成素材）——用不夠真實的測試素材「驗證通過」不代表真的修好了，這次因為使用者回報「還是會發生」才逼出更嚴謹的重驗，兩次教訓都直接寫進這裡，避免以後又想加回 rVFC。若之後真的還有殘留的閃爍/黑屏，優先方向是查其他成因（轉場交界、多軌同時可見的影片元素、`realtimeExport` 備援路徑——這個路徑完全沒用到 `seekVisualsTo`，走的是即時播放的 `syncMedia()`，這次修正沒有觸及），不要再回頭加 rVFC。

## 編輯預覽「按暫停鍵時會出現黑屏」修正（2026-08-19 新增）

跟上面「匯出閃爍／黑屏」是**兩個不同的 bug**——那個發生在匯出（`export.js` 的 `fastExport`），這個發生在**編輯畫面的即時預覽播放**（`preview.js` 的 `VE.play`/`VE.pause`），成因也完全不同，不要混為一談。

根因在 `syncMedia(t, isPlaying)` 的容差設計：播放中用寬鬆容差 `tol = 0.25`（讓 `<video>` 元素自然播放、不用每幀都強制 seek），暫停時改用嚴格容差 `tol = 0.03`（要求畫面精確對齊播放頭位置）。播放中 `el.currentTime` 跟播放頭之間的自然漂移量，經常剛好落在 0.03～0.25 之間這個「播放時可接受、暫停時不可接受」的區間——按下暫停的瞬間，`VE.pause()` 內部呼叫 `syncMedia(t, false)` 會因為這個漂移觸發一次新的 `el.currentTime = st` 校正 seek，但 seek 是非同步的，緊接著呼叫的 `VE.drawFrame()` 幾乎必然畫在新畫面真正解碼完成之前，抓到黑畫面或殘影；播放時鐘已經停了（`rafId` 已取消），之後不會再有任何一次 `requestAnimationFrame` 補畫，畫面就這樣卡住不動。

**修法**：`VE.seek()` 其實早就有同樣情境的修正——seek 完成後用 `setTimeout(..., 120)` 延遲補畫一次，確保拿到解碼完成的畫面——但當初只加在 `VE.seek()`，`VE.pause()` 沒有比照套用。把同一套「延遲補畫」邏輯加到 `VE.pause()`：`clearTimeout(redrawTimer); redrawTimer = setTimeout(function(){ VE.drawFrame(); }, 120);`（`redrawTimer` 變數兩個函式共用，宣告移到 `VE.pause` 之前）。

**已用 Playwright 端對端驗證**：因為單純等待真實播放時鐘（`requestAnimationFrame`）在無焦點/背景分頁下會被瀏覽器嚴重節流（實測 600ms 只推進了 0.1 秒的播放頭，難以穩定命中漂移區間），改用更精確的重現方式——直接操作 `<video>` 元素：先把它 seek 到片段的紅色段（0.5 秒）並等待 `seeked` 完成（確保 canvas 真的畫出紅色），再模擬「播放頭已經在綠色段（3.0 秒）但 video 元素 `currentTime` 還停在紅色段」這個播放中會出現的漂移狀態（`VE.state.playing=true; VE.state.playhead=3.0`），呼叫 `VE.pause()`。結果：**暫停瞬間立刻讀 canvas 是黑色（重現成功、對應修法前會卡住不動的畫面）**，等待超過 120ms 延遲補畫的時間後**畫面正確變成綠色**。根目錄版與 `mrvideo_s` 同步套用、同一套測試各自驗證一次，結果一致。

## 匯入影片時長自動修正（2026-08-19 新增）

使用者回報「上傳影片的時數，拉入影片軌中出現時數不一致」。實際重現（用 `MediaRecorder` 合成測試影片）確認根因：部分影片（常見於螢幕錄影軟體、特定手機 App 匯出，容器裡記錄的時長中繼資料不準確）瀏覽器 `<video>` 回報的 `duration` 會比實際可播放內容長，多出來的部分播放/匯出時畫面會停格在最後一幀——素材庫縮圖顯示的時長、拖進時間軸後的片段長度，兩者用的都是這個同一個（錯的）數字，所以看起來「一致」但都跟實際內容對不上。

- **沒有可靠的瀏覽器 API 能直接查出真正的內容長度**（`v.duration`／`v.buffered`／`v.seekable` 在這個情境下全部回報同一個錯誤值；`currentTime=Infinity` 現代瀏覽器會直接丟例外；就算實際播放到底，瀏覽器也只是把最後一幀停格撐到宣告的時長，不會提早觸發 `ended`——這些都已實測驗證過，不是猜測）。
- **修法**（`media.js` 的 `detectFrozenTail(v, rawDuration)`）：用 12×12 極小畫布逐格比對像素、二分搜尋找出「畫面內容開始跟結尾幀不再有明顯差異」的時間點，回推真實時長。門檻刻意保守（至少差 0.3 秒且超過原始時長 3% 以上才採信修正），避免把影片本身合理的「結尾停格鏡頭」這種創作手法誤判成錯誤而裁短。
- `probeVideo()` 回傳的 `meta` 同時帶 `duration`（修正後，供顯示與預設片段長度使用）與 `rawDuration`（修正前的原始值）；`m.rawDuration` 存進素材物件，`timeline.js` 的邊緣拖曳延伸上限（trim-r 的 `maxDur`）改用 `m.rawDuration || m.duration` 而非單純 `m.duration`——**這樣即使自動偵測誤判把長度修短了，使用者仍可手動拖曳片段右邊緣拉回被裁掉的部分**，是這個修正的安全網設計，不是不可逆的裁切。
- 有修正發生時會 toast 提示：「已修正偵測到的時長（原始檔案的時長資訊不準確...）」，讓使用者知道發生過自動修正，不是靜默改動。
- **已知限制**：偵測邏輯本質是啟發式（heuristic），對「內容本身變化幅度很小」的影片（例如畫面幾乎靜止的簡報錄影）有極小機率誤判；binary search 假設「畫面跟結尾幀的差異程度隨時間單調變化」，對極端內容（例如以極高頻率在兩個畫面間切換）可能收斂到不夠精確的邊界，但仍會顯著改善（比完全不修正好上許多），真實世界的攝影機/螢幕錄影內容通常有連續漸變的動態，不會像測試用的合成畫面那樣極端。已用 Playwright 合成 `MediaRecorder` 影片重現「回報 6.6～14.5 秒、實際只有 2.2 秒」的真實案例，修正後大幅縮小誤差（不一定能精確命中真實邊界，但遠優於原始錯誤值）。根目錄版與 `mrvideo_s` 同步套用。

## 已知限制

- 快速匯出需要 WebCodecs（Chrome/Edge）＋ CDN 載入 mp4-muxer；兩者缺一自動退回即時錄製（耗時＝影片長度）。快速匯出中音訊的曲線變速以平均速率近似。
- MediaRecorder 產生的 webm 當作素材再匯入時 seek 精度差（無 cue index）；一般 mp4 素材無此問題。**注意：這跟上面「匯入影片時長自動修正」是相關但不同的問題**——seek 精度差是指「seek 到某個時間點時實際定位到的畫面跟要求的時間點有落差」，時長修正是指「宣告的總時長本身就是錯的」，兩者都源自 webm 缺少完整索引，但影響的層面不同。
- 變速曲線以動態 `playbackRate` 近似，音調隨速度改變；分割帶曲線的片段會重設為等速。
- 「🤖 語音轉字幕」需要使用者自備 **Gemini API 金鑰**（左側「⚙️設定」分頁填入，Google AI Studio 有免費額度），且需要網路連線；混音後的音訊超過 15MB 會直接失敗，需縮短時間軸長度分段辨識。時間戳記是 Gemini 自行估算，不像專門的語音辨識服務有精確對齊，生成後建議手動核對每句字幕的時間點。

## 安裝程式（MrVideo/）

`MrVideo/build.ps1` 一鍵打包 `MrVideo/影片先生安裝程式.exe`（62KB 單檔、零外部相依；原始碼 `Installer.cs`、`make_manual.py` 同資料夾）：
1. `make_manual.py` 把 README.md 轉成獨立樣式的 `manual.html`（自寫的 markdown 轉換器，頁尾連結與桌面捷徑都指向它）；
2. 把 index.html＋css＋js＋README.md＋manual.html 壓成 zip；
3. 以 Windows 內建 `csc.exe`（.NET Framework 4.x）編譯 `Installer.cs`，zip 以 `/resource` 內嵌。

安裝程式行為：解壓到 `%LOCALAPPDATA%\影片先生`、桌面建「影片先生」與「影片先生操作手冊」兩個 .url 捷徑（file:/// 中文路徑走 `Uri.AbsoluteUri` 百分比編碼）、詢問是否開啟；`/S` 靜默模式供測試。**注意：build.ps1 必須維持純 ASCII**（PS 5.1 會把無 BOM 檔案當 ANSI 讀，中文註解會弄壞解析）；Installer.cs 的中文靠 `csc /codepage:65001` 處理。改動網站檔案後重新執行 build.ps1 即可更新安裝包。

## 驗證方式

`node --check js/*.js` 檢查語法；用 Playwright / Preview 開啟 `http://localhost:8766/index.html`，可在 console 以 `VE.importFiles([File])` 程式化匯入合成素材做端到端測試（見 git/對話紀錄中的煙霧測試腳本模式）。

## 課程教學版（mrvideo_s/）

子資料夾 `mrvideo_s/` 是給學員使用的教學版：功能與根目錄版本相同，差異：**「🤖 語音轉字幕」需先在頂部序號列輸入「課程授權序號」並驗證通過才能使用，其餘功能（剪輯、匯出等）不受影響、永久可用**（比照 `sbir-generator/sbir-gen-s`、`icap-generator/icap_s` 只鎖單一 AI 功能的模式）。透過獨立的 Google Apps Script／Google Sheet 檢查，序號自第一次驗證起提供 12 個月使用期限。**2026-08-19：架構從「鎖整個工具」（全螢幕遮罩）改成「只鎖語音轉字幕」（頂部 banner），序號輸入位置也從遮罩移到頁面頂部**；同一批改動也把語音轉字幕從只支援 Gemini 擴充成可選 Gemini／OpenAI Whisper（Claude 不支援音訊輸入、OpenRouter 音訊支援不一，故未提供）。另外匯出的影片會燒錄「影片先生 課程教學版」浮水印（只在 `VE.exporting` 為真時才畫，編輯預覽不受影響）＋加入主畫面（PWA，manifest/service-worker/icons）；根目錄版本沒有這兩項（浮水印比照教學版慣例只鎖教學版，根目錄一般版維持乾淨輸出）。窄螢幕鎖定提示（`@media max-width:600px`）根目錄版與教學版皆早已存在。詳見 `mrvideo_s/CLAUDE.md`。**這是獨立複製的 `index.html`／`css`／`js`，不是共用檔案**——根目錄版本異動時（含這次修掉的音訊交界喀聲問題）不會自動同步過去，需要時手動套用。
