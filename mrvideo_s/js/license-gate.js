/* license-gate.js — 課程教學版序號授權閘門
   獨立於 window.VE 之外運作：頁面載入時預設鎖定（全畫面遮罩），
   序號驗證通過才會隱藏遮罩、放行整個工具。
   部署 Apps Script 後把取得的網址填入下面的 LICENSE_CHECK_URL。 */
(function () {
  'use strict';

  var LICENSE_CHECK_URL = "https://script.google.com/macros/s/AKfycbzcaiXxjd8ENqd5aXLqX2Z_ZIhTUlHuyKIJKzyz43DnK1Yu1tn-N50cvuNKhz24RSEA/exec";
  var STORAGE_KEY = 'mrvideoSSerial';
  var RECHECK_MS = 20 * 60 * 1000;   // 每 20 分鐘背景重新驗證一次，逾期會重新鎖定畫面

  var gate = document.getElementById('licenseGate');
  var input = document.getElementById('gateSerial');
  var toggleBtn = document.getElementById('btnGateToggle');
  var confirmBtn = document.getElementById('btnGateConfirm');
  var statusEl = document.getElementById('gateStatus');
  var miniEl = document.getElementById('gateStatusMini');

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

  function unlock(license) {
    var label = fmtDays(license) || '序號有效';
    statusEl.className = 'gate-status ok';
    statusEl.textContent = '✓ ' + label;
    gate.classList.add('hidden');
    if (miniEl) {
      miniEl.textContent = '🔑 ' + label;
      miniEl.className = 'footer-credit gate-mini';
    }
  }

  function lock(reasonText) {
    statusEl.className = 'gate-status bad';
    statusEl.textContent = '✗ ' + reasonText;
    gate.classList.remove('hidden');
    if (miniEl) {
      miniEl.textContent = '🔒 授權已失效，請重新驗證';
      miniEl.className = 'footer-credit gate-mini bad';
    }
  }

  async function runCheck(serial, opts) {
    opts = opts || {};
    if (!serial) {
      statusEl.className = 'gate-status bad';
      statusEl.textContent = REASON_LABEL.missing_serial;
      return { valid: false, reason: 'missing_serial' };
    }
    if (!opts.silent) {
      statusEl.className = 'gate-status pending';
      statusEl.textContent = '驗證中…';
    }
    try {
      var license = await checkLicense(serial);
      if (license.valid) unlock(license);
      else lock(REASON_LABEL[license.reason] || license.message || '授權序號驗證失敗');
      return license;
    } catch (err) {
      lock(err.message);
      return { valid: false, reason: 'network_error', message: err.message };
    }
  }

  confirmBtn.addEventListener('click', function () {
    var serial = input.value.trim();
    saveSerial(serial);
    runCheck(serial);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
  });
  toggleBtn.addEventListener('click', function () {
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  input.value = loadSerial();
  if (input.value) runCheck(input.value, { silent: true });

  /* 背景定期重新驗證：不永久快取「已通過」狀態，逾期會重新鎖定畫面 */
  setInterval(function () {
    var serial = loadSerial();
    if (serial) runCheck(serial, { silent: true });
  }, RECHECK_MS);
})();
