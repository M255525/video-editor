# video-editor — 影片先生

參考剪映（CapCut）桌面版的**瀏覽器端影片編輯器**（產品名「影片先生」，創作者 Mark Tsai；頁尾與匯出視窗固定顯示「僅供教學、課程及個人使用」警語，勿移除）。純前端、無 build step、無框架、無外部相依；以 `file://` 開啟或任何靜態伺服器託管皆可（`.claude/launch.json` 已有 `video-editor` 設定，port 8766）。建議使用 Chrome / Edge。

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
| `js/media.js` | 匯入（input/拖放）、metadata 探測與縮圖、素材庫 UI、隱藏 `<video>/<audio>` 元素池 `VE.clipEls` |
| `js/preview.js` | Canvas 2D 逐幀合成（濾鏡 `ctx.filter`、關鍵影格 transform、轉場、文字/貼圖）、rAF 播放時鐘、Web Audio 混音、預覽畫布拖曳移動 |
| `js/timeline.js` | 多軌時間軸：渲染、拖曳/跨軌搬移、邊緣裁切、分割、吸附、sticky 尺規（只畫可視範圍，避開 canvas 寬度上限） |
| `js/panels.js` | 左側（文字預設/emoji 貼圖/濾鏡預設/轉場卡片）＋右側屬性面板（變換+關鍵影格◆、變速、音訊、濾鏡滑桿、文字樣式） |
| `js/export.js` | 雙模式匯出：優先 **WebCodecs 離線快速匯出**（逐幀 seek→合成→VideoEncoder H.264 + OfflineAudioContext 混音→AudioEncoder AAC/Opus + mp4-muxer 封裝，無需播放）；不支援時退回 MediaRecorder 即時錄製。mp4-muxer 走 jsdelivr CDN（index.html），離線/載入失敗自動退回即時錄製 |
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

## 已知限制

- 快速匯出需要 WebCodecs（Chrome/Edge）＋ CDN 載入 mp4-muxer；兩者缺一自動退回即時錄製（耗時＝影片長度）。快速匯出中音訊的曲線變速以平均速率近似。
- MediaRecorder 產生的 webm 當作素材再匯入時 seek 精度差（無 cue index）；一般 mp4 素材無此問題。
- 變速曲線以動態 `playbackRate` 近似，音調隨速度改變；分割帶曲線的片段會重設為等速。

## 安裝程式（MrVideo/）

`MrVideo/build.ps1` 一鍵打包 `MrVideo/影片先生安裝程式.exe`（62KB 單檔、零外部相依；原始碼 `Installer.cs`、`make_manual.py` 同資料夾）：
1. `make_manual.py` 把 README.md 轉成獨立樣式的 `manual.html`（自寫的 markdown 轉換器，頁尾連結與桌面捷徑都指向它）；
2. 把 index.html＋css＋js＋README.md＋manual.html 壓成 zip；
3. 以 Windows 內建 `csc.exe`（.NET Framework 4.x）編譯 `Installer.cs`，zip 以 `/resource` 內嵌。

安裝程式行為：解壓到 `%LOCALAPPDATA%\影片先生`、桌面建「影片先生」與「影片先生操作手冊」兩個 .url 捷徑（file:/// 中文路徑走 `Uri.AbsoluteUri` 百分比編碼）、詢問是否開啟；`/S` 靜默模式供測試。**注意：build.ps1 必須維持純 ASCII**（PS 5.1 會把無 BOM 檔案當 ANSI 讀，中文註解會弄壞解析）；Installer.cs 的中文靠 `csc /codepage:65001` 處理。改動網站檔案後重新執行 build.ps1 即可更新安裝包。

## 驗證方式

`node --check js/*.js` 檢查語法；用 Playwright / Preview 開啟 `http://localhost:8766/index.html`，可在 console 以 `VE.importFiles([File])` 程式化匯入合成素材做端到端測試（見 git/對話紀錄中的煙霧測試腳本模式）。
