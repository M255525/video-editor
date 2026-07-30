/* util.js — 共用工具與命名空間起點（classic script，掛在 window.VE） */
window.VE = window.VE || {};
(function (VE) {
  'use strict';

  VE.uid = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  VE.clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  VE.lerp = function (a, b, t) { return a + (b - a) * t; };

  /** 秒數 → "mm:ss.cc" */
  VE.fmtTime = function (s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    var cs = Math.floor((s % 1) * 100);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(m) + ':' + p(sec) + '.' + p(cs);
  };

  VE.debounce = function (fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  /* ── 變速曲線：p(0..1 時間軸進度) → q(0..1 素材進度)，q(0)=0、q(1)=1 ── */
  VE.CURVES = {
    constant: { name: '等速', f: function (p) { return p; } },
    montage:  { name: '蒙太奇（慢→快）', f: function (p) { return p * p; } },
    bullet:   { name: '子彈時間（快→慢）', f: function (p) { return 1 - (1 - p) * (1 - p); } },
    hero:     { name: '英雄時刻（中間慢）', f: function (p) { return 0.5 + 4 * Math.pow(p - 0.5, 3); } },
    ease:     { name: '兩端慢', f: function (p) { return p * p * (3 - 2 * p); } }
  };

  /** 曲線在 p 處的瞬時速率（數值微分），用於動態調整媒體元素 playbackRate */
  VE.curveRate = function (curveId, p) {
    var c = VE.CURVES[curveId] || VE.CURVES.constant;
    var e = 0.001;
    var p0 = VE.clamp(p - e, 0, 1), p1 = VE.clamp(p + e, 0, 1);
    if (p1 === p0) return 1;
    return (c.f(p1) - c.f(p0)) / (p1 - p0);
  };

  /* ── 關鍵影格 ──
     clip.keyframes = { prop: [{t, v}, ...] }，t 為相對片段起點的時間軸秒數。
     沒有該屬性的關鍵影格時，回傳 clip.transform[prop] 靜態值。 */
  VE.kfValue = function (clip, prop, tRel) {
    var kfs = clip.keyframes && clip.keyframes[prop];
    var base = (clip.transform && prop in clip.transform) ? clip.transform[prop] : 0;
    if (!kfs || !kfs.length) return base;
    var arr = kfs.slice().sort(function (a, b) { return a.t - b.t; });
    if (tRel <= arr[0].t) return arr[0].v;
    if (tRel >= arr[arr.length - 1].t) return arr[arr.length - 1].v;
    for (var i = 0; i < arr.length - 1; i++) {
      var a = arr[i], b = arr[i + 1];
      if (tRel >= a.t && tRel <= b.t) {
        var span = b.t - a.t;
        return span <= 0 ? b.v : VE.lerp(a.v, b.v, (tRel - a.t) / span);
      }
    }
    return base;
  };

  /** 是否恰有一個關鍵影格落在 tRel（容差半格） */
  VE.kfAt = function (clip, prop, tRel, eps) {
    var kfs = clip.keyframes && clip.keyframes[prop];
    if (!kfs) return null;
    eps = eps || 0.034;
    for (var i = 0; i < kfs.length; i++) {
      if (Math.abs(kfs[i].t - tRel) <= eps) return kfs[i];
    }
    return null;
  };

  /** 設定/更新 tRel 處的關鍵影格 */
  VE.kfSet = function (clip, prop, tRel, v) {
    if (!clip.keyframes) clip.keyframes = {};
    if (!clip.keyframes[prop]) clip.keyframes[prop] = [];
    var hit = VE.kfAt(clip, prop, tRel);
    if (hit) { hit.v = v; }
    else {
      clip.keyframes[prop].push({ t: Math.max(0, tRel), v: v });
      clip.keyframes[prop].sort(function (a, b) { return a.t - b.t; });
    }
  };

  VE.kfRemove = function (clip, prop, tRel) {
    var kfs = clip.keyframes && clip.keyframes[prop];
    if (!kfs) return;
    var hit = VE.kfAt(clip, prop, tRel);
    if (hit) {
      clip.keyframes[prop] = kfs.filter(function (k) { return k !== hit; });
      if (!clip.keyframes[prop].length) delete clip.keyframes[prop];
    }
  };

  /* ── Toast ── */
  var toastTimer = null;
  VE.toast = function (msg, ms) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, ms || 2200);
  };
})(window.VE);
