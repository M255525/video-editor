/* license-gate.js — 課程教學版「語音轉字幕」序號授權
   跟原本鎖整個工具的做法不同：這裡只是頂部一列 banner（#licenseBar），
   不會擋住剪輯/匯出等其他功能。VE.runLicenseCheck() 供 panels.js 在使用者
   按下「🤖 辨識全片講話並生成字幕」時即時呼叫重新驗證（不做本機快取信任），
   確保序號逾期後即使先前驗證過也無法再用該功能。
   部署 Apps Script 後把取得的網址填入下面的 LICENSE_CHECK_URL（與舊版共用同一支 Code.gs）。 */
window.VE = window.VE || {};
(function (VE) {
  'use strict';

  var LICENSE_CHECK_URL = "https://script.google.com/macros/s/AKfycbzcaiXxjd8ENqd5aXLqX2Z_ZIhTUlHuyKIJKzyz43DnK1Yu1tn-N50cvuNKhz24RSEA/exec";
  var STORAGE_KEY = 'mrvideoSSerial';

  var input = document.getElementById('licenseSerial');
  var toggleBtn = document.getElementById('btnLicenseToggle');
  var checkBtn = document.getElementById('btnLicenseCheck');
  var statusEl = document.getElementById('licenseStatus');

  function loadSerial() { return localStorage.getItem(STORAGE_KEY) || ''; }
  function saveSerial(s) { localStorage.setItem(STORAGE_KEY, s); }

  var REASON_LABEL = {
    missing_serial: '請輸入課程授權序號',
    serial_not_found: '查無此授權序號，請確認輸入是否正確',
    expired: '此序號已逾使用期限',
    network_error: '無法連線授權伺服器，請檢查網路連線',
    server_error: '授權伺服器發生錯誤，請稍後再試'
  };

  async function checkLicense(serial) {
    if (!LICENSE_CHECK_URL) {
      throw new Error('尚未設定授權伺服器網址，請聯繫課程負責人');
    }
    var resp;
    try {
      // 不設自訂 Content-Type，避免觸發 CORS 預檢（Apps Script Web App 不處理 OPTIONS）
      resp = await fetch(LICENSE_CHECK_URL, {
        method: 'POST',
        body: JSON.stringify({ serial: serial }),
        signal: AbortSignal.timeout(20000)
      });
    } catch (err) {
      throw new Error(err.name === 'TimeoutError' ? '授權伺服器連線逾時，請檢查網路連線後再試一次' : '無法連線授權伺服器，請檢查網路連線');
    }
    if (!resp.ok) throw new Error('授權伺服器回應異常（' + resp.status + '）');
    return resp.json();
  }

  function fmtDays(license) {
    if (!license.expiresAt) return '';
    var expireStr = new Date(license.expiresAt).toLocaleDateString();
    var days = Math.ceil((new Date(license.expiresAt) - new Date()) / 86400000);
    return '剩餘 ' + Math.max(days, 0) + ' 天可用（至 ' + expireStr + '）';
  }

  function labelFor(license) {
    if (license.valid) return fmtDays(license) || '序號有效';
    return REASON_LABEL[license.reason] || license.message || '授權序號驗證失敗';
  }

  function render(license) {
    if (!statusEl) return;
    if (license.valid == null) {
      statusEl.className = 'lic-status pending';
      statusEl.textContent = license.label;
      return;
    }
    statusEl.className = 'lic-status ' + (license.valid ? 'ok' : 'bad');
    statusEl.textContent = (license.valid ? '✓ ' : '✗ ') + license.label;
  }

  /** 即時重新驗證目前存的序號（不信任本機快取），回傳正規化 {valid, reason, message?, expiresAt?, label}。
      opts.silent：跳過「驗證中…」的過渡文字，但最終結果一律會更新 banner。 */
  VE.runLicenseCheck = async function (opts) {
    opts = opts || {};
    var serial = loadSerial();
    var license;
    if (!serial) {
      license = { valid: false, reason: 'missing_serial' };
    } else {
      if (!opts.silent) render({ valid: null, label: '驗證中…' });
      try {
        license = await checkLicense(serial);
      } catch (err) {
        license = { valid: false, reason: 'network_error', message: err.message };
      }
    }
    license.label = labelFor(license);
    render(license);
    return license;
  };

  checkBtn.addEventListener('click', function () {
    saveSerial(input.value.trim());
    VE.runLicenseCheck();
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); checkBtn.click(); }
  });
  toggleBtn.addEventListener('click', function () {
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  input.value = loadSerial();
  if (input.value) VE.runLicenseCheck({ silent: true });
})(window.VE);
