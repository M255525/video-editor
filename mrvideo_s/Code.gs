/**
 * 影片先生（課程教學版）授權伺服器 —— 貼到 Google Sheet 的「擴充功能 > Apps Script」，
 * 部署為 Web App 後，把取得的網址填進 index.html 的 LICENSE_CHECK_URL
 * （js/license-gate.js 開頭的 var LICENSE_CHECK_URL = "";）。
 * 完整部署步驟見 SETUP-授權伺服器設定.md。
 *
 * 對應的 Google Sheet 需有這三個表頭欄位（欄位順序不拘、可以跟其他既有欄位混在一起，
 * 程式是用表頭文字比對欄位、不是靠欄位順序）：序號 / 開始日期 / 結束日期。
 * 開一個新的授權對象（新班級）時：在表格新增一列，填「序號」欄，
 * 「開始日期」「結束日期」留空——序號第一次被驗證時會自動寫入
 * （開始日期＝當下時間，結束日期＝開始日期 + 12 個月）。
 */

const VALID_AMOUNT = 12;
const COL_SERIAL = "序號";
const COL_START = "開始日期";
const COL_END = "結束日期";
// 若序號資料不在第一個工作表，把分頁名稱填在這裡；留空則自動用第一個工作表
const SHEET_NAME = "";

function doPost(e) {
  let result;
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const serial = String(payload.serial || "").trim();
    result = serial ? checkOrActivate(serial) : { valid: false, reason: "missing_serial" };
  } catch (err) {
    result = { valid: false, reason: "server_error", message: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// 方便部署後用瀏覽器直接開網址測試是否部署成功（doGet 用 curl -sL 或直接貼網址開都沒問題，
// 但 doPost 不要用 curl 測，會被 Google 的轉址機制誤導成失敗）
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    message: "授權伺服器運作中。請用 POST 傳送 JSON body，例如 {\"serial\":\"your-serial-here\"}"
  })).setMimeType(ContentService.MimeType.JSON);
}

function getLicenseSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return (SHEET_NAME && ss.getSheetByName(SHEET_NAME)) || ss.getSheets()[0];
}

function checkOrActivate(serial) {
  // LockService 避免多人同時第一次驗證同一組序號時，開卡時間被寫兩次、算出不同的到期日
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getLicenseSheet_();
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return { valid: false, reason: "serial_not_found" };

    const header = values[0];
    const colSerial = header.indexOf(COL_SERIAL);
    const colStart = header.indexOf(COL_START);
    const colEnd = header.indexOf(COL_END);
    if (colSerial < 0 || colStart < 0 || colEnd < 0) {
      return { valid: false, reason: "server_error", message: "表頭找不到「" + COL_SERIAL + "」「" + COL_START + "」「" + COL_END + "」欄位" };
    }

    let rowIdx = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][colSerial]).trim() === serial) { rowIdx = i; break; }
    }
    if (rowIdx === -1) return { valid: false, reason: "serial_not_found" };

    const sheetRow = rowIdx + 1; // 轉成 1-indexed 的實際列號
    let startVal = values[rowIdx][colStart];
    let endVal = values[rowIdx][colEnd];
    const now = new Date();

    // 第一次有人驗證這組序號：開始計時
    if (!startVal) {
      startVal = now;
      sheet.getRange(sheetRow, colStart + 1).setValue(startVal);
    }
    // 若結束日期還沒算過（或開始日期是這次才補的），依開始日期 + 12 個月算出
    if (!endVal) {
      endVal = new Date(startVal);
      endVal.setMonth(endVal.getMonth() + VALID_AMOUNT);
      sheet.getRange(sheetRow, colEnd + 1).setValue(endVal);
    }

    const endDate = new Date(endVal);
    endDate.setHours(23, 59, 59, 999); // 結束日當天結束前都算有效
    const valid = now.getTime() <= endDate.getTime();

    return {
      valid: valid,
      reason: valid ? "ok" : "expired",
      activatedAt: new Date(startVal).toISOString(),
      expiresAt: new Date(endVal).toISOString()
    };
  } finally {
    lock.releaseLock();
  }
}
