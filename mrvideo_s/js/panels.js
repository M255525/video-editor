/* panels.js — 左側面板（文字/貼圖/濾鏡/轉場）＋ 右側屬性面板 */
(function (VE) {
  'use strict';

  /* ── 預設資料 ── */
  var TEXT_PRESETS = [
    { name: '標題', content: '主標題', size: 88, bg: false, y: 0 },
    { name: '字幕', content: '這是一行字幕', size: 44, bg: false, y: 0.36 },
    { name: '標語（含底色）', content: '重點標語', size: 64, bg: true, y: 0 }
  ];

  var STICKERS = ['😀','😂','😍','🥳','😎','🤔','👍','👏','🎉','🎊','❤️','🔥','⭐','✨','💯','💡','🎵','🎬','📣','⚠️','✅','❌','➡️','⬅️','☀️','🌙','🌈','⚡','💰','🏆'];

  var FILTER_PRESETS = {
    none:  { name: '原圖', icon: '⬜', v: { brightness: 0, contrast: 0, saturate: 0, hue: 0, blur: 0 } },
    vivid: { name: '鮮明', icon: '🌈', v: { brightness: 0.05, contrast: 0.15, saturate: 0.35, hue: 0, blur: 0 } },
    warm:  { name: '暖陽', icon: '🌇', v: { brightness: 0.06, contrast: 0.05, saturate: 0.15, hue: -14, blur: 0 } },
    cold:  { name: '冷調', icon: '🧊', v: { brightness: 0.02, contrast: 0.05, saturate: -0.1, hue: 14, blur: 0 } },
    retro: { name: '復古', icon: '📻', v: { brightness: -0.04, contrast: -0.1, saturate: -0.35, hue: -10, blur: 0 } },
    film:  { name: '膠片', icon: '🎞️', v: { brightness: -0.05, contrast: 0.2, saturate: -0.2, hue: 0, blur: 0 } },
    bw:    { name: '黑白', icon: '⚫', v: { brightness: 0, contrast: 0.1, saturate: -1, hue: 0, blur: 0 } },
    dream: { name: '夢幻', icon: '💭', v: { brightness: 0.1, contrast: -0.05, saturate: 0.2, hue: 0, blur: 1.5 } },
    blurfx:{ name: '畫面模糊', icon: '🌫️', v: { brightness: 0, contrast: 0, saturate: 0, hue: 0, blur: 6 } }
  };

  var TRANSITIONS = {
    none:      { name: '無', icon: '⬜' },
    crossfade: { name: '交疊淡化', icon: '🔀' },
    fadeblack: { name: '黑場過渡', icon: '⬛' },
    wipe:      { name: '擦除', icon: '➡️' },
    slide:     { name: '滑動', icon: '↔️' }
  };

  /* ── 左側面板初始化 ── */
  VE.initPanels = function () {
    /* Tab 切換 */
    document.querySelectorAll('.ltab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.ltab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
      });
    });

    /* 文字預設 */
    var tp = document.getElementById('textPresets');
    TEXT_PRESETS.forEach(function (pr) {
      var card = document.createElement('div');
      card.className = 'text-preset';
      card.style.fontSize = Math.min(24, pr.size / 3.2) + 'px';
      card.style.fontWeight = 'bold';
      card.textContent = pr.name;
      card.onclick = function () { addTextClip(pr); };
      tp.appendChild(card);
    });

    /* SRT / VTT 字幕匯入 */
    var srtBtn = document.getElementById('btnSrt');
    var srtInput = document.getElementById('srtInput');
    srtBtn.addEventListener('click', function () { srtInput.click(); });
    srtInput.addEventListener('change', function () {
      Array.prototype.slice.call(srtInput.files).forEach(function (f) { VE.importSRT(f); });
      srtInput.value = '';
    });

    /* 語音轉字幕（需自備所選服務商 API 金鑰＋頂部課程授權序號驗證通過；金鑰與服務商選擇在左側「⚙️設定」分頁，按鈕與結果在「🅣文字」分頁） */
    var asrProviderSel = document.getElementById('asrProvider');
    var asrKeyGemini = document.getElementById('asrApiKeyGemini');
    var asrKeyOpenai = document.getElementById('asrApiKeyOpenai');
    var asrBtn = document.getElementById('btnAsr');
    var asrMsg = document.getElementById('asrMsg');
    var asrMsgDefault = asrMsg.textContent;

    function currentAsrKeyInput() {
      return asrProviderSel.value === 'openai' ? asrKeyOpenai : asrKeyGemini;
    }
    function syncAsrProviderUI() {
      var isOpenai = asrProviderSel.value === 'openai';
      asrKeyGemini.classList.toggle('hidden', isOpenai);
      asrKeyOpenai.classList.toggle('hidden', !isOpenai);
    }

    asrProviderSel.value = localStorage.getItem('video-editor-asr-provider') || 'gemini';
    syncAsrProviderUI();
    asrProviderSel.addEventListener('change', function () {
      localStorage.setItem('video-editor-asr-provider', asrProviderSel.value);
      syncAsrProviderUI();
    });

    asrKeyGemini.value = localStorage.getItem('video-editor-gemini-key') || '';
    asrKeyGemini.addEventListener('change', function () {
      localStorage.setItem('video-editor-gemini-key', asrKeyGemini.value.trim());
    });
    asrKeyOpenai.value = localStorage.getItem('video-editor-openai-key') || '';
    asrKeyOpenai.addEventListener('change', function () {
      localStorage.setItem('video-editor-openai-key', asrKeyOpenai.value.trim());
    });

    asrBtn.addEventListener('click', function () {
      var provider = asrProviderSel.value;
      var keyInput = currentAsrKeyInput();
      var key = keyInput.value.trim();
      if (!key) { asrMsg.textContent = '✗ 請先在左側「⚙️設定」填入 API 金鑰'; return; }
      localStorage.setItem(provider === 'openai' ? 'video-editor-openai-key' : 'video-editor-gemini-key', key);

      asrBtn.disabled = true;
      asrMsg.textContent = '驗證課程授權序號中…';
      VE.runLicenseCheck().then(function (license) {
        if (!license.valid) {
          asrMsg.textContent = '✗ ' + license.label + '（請至頂部「語音轉字幕課程授權序號」欄位輸入）';
          asrBtn.disabled = false;
          return;
        }
        asrMsg.textContent = '準備中…';
        VE.transcribeSpeech(provider, key, function (m) { asrMsg.textContent = m; })
          .then(function (segments) {
            var n = VE.addTranscriptSegments(segments);
            asrMsg.textContent = '✓ 已辨識並新增 ' + n + ' 句字幕';
            VE.toast('語音轉字幕完成，共 ' + n + ' 句');
          })
          .catch(function (e) {
            asrMsg.textContent = '✗ ' + e.message;
          })
          .finally(function () {
            asrBtn.disabled = false;
            setTimeout(function () { asrMsg.textContent = asrMsgDefault; }, 6000);
          });
      });
    });

    /* 貼圖 */
    var sg = document.getElementById('stickerGrid');
    STICKERS.forEach(function (emo) {
      var b = document.createElement('button');
      b.className = 'sticker-btn';
      b.textContent = emo;
      b.onclick = function () { addStickerClip(emo); };
      sg.appendChild(b);
    });

    /* 濾鏡卡片 */
    var fc = document.getElementById('filterCards');
    Object.keys(FILTER_PRESETS).forEach(function (key) {
      var f = FILTER_PRESETS[key];
      var card = document.createElement('div');
      card.className = 'fx-card';
      card.dataset.filter = key;
      card.innerHTML = '<div class="fx-icon">' + f.icon + '</div><div class="fx-name">' + f.name + '</div>';
      card.onclick = function () { applyFilterPreset(key); };
      fc.appendChild(card);
    });

    /* 轉場卡片 */
    var tc = document.getElementById('transitionCards');
    Object.keys(TRANSITIONS).forEach(function (key) {
      var tr = TRANSITIONS[key];
      var card = document.createElement('div');
      card.className = 'fx-card';
      card.dataset.transition = key;
      card.innerHTML = '<div class="fx-icon">' + tr.icon + '</div><div class="fx-name">' + tr.name + '</div>';
      card.onclick = function () { applyTransition(key); };
      tc.appendChild(card);
    });
  };

  function overlayTrack() {
    return VE.state.project.tracks.filter(function (t) { return t.type === 'overlay'; })[0];
  }

  function placeOnTrack(track, dur) {
    var start = VE.state.playhead;
    if (VE.overlaps(track, start, dur, null)) start = VE.trackEnd(track);
    return start;
  }

  function addTextClip(preset) {
    var track = overlayTrack();
    if (!track) return;
    var start = placeOnTrack(track, 3);
    var clip = VE.newClip({ type: 'text', start: start, duration: 3, content: preset.content, size: preset.size });
    clip.text.bg = preset.bg;
    clip.transform.y = (preset.y || 0) * VE.state.project.height;
    track.clips.push(clip);
    VE.state.selection = clip.id;
    VE.commit();
    VE.refreshAll();
    VE.toast('已加入文字，於右側面板編輯內容');
  }

  function addStickerClip(emoji) {
    var track = overlayTrack();
    if (!track) return;
    var start = placeOnTrack(track, 3);
    var clip = VE.newClip({ type: 'sticker', start: start, duration: 3, emoji: emoji });
    track.clips.push(clip);
    VE.state.selection = clip.id;
    VE.commit();
    VE.refreshAll();
  }

  function applyFilterPreset(key) {
    var sel = VE.selectedClip();
    if (!sel || (sel.clip.type !== 'video' && sel.clip.type !== 'image')) {
      VE.toast('請先選取影片或圖片片段'); return;
    }
    var v = FILTER_PRESETS[key].v;
    sel.clip.filter = { brightness: v.brightness, contrast: v.contrast, saturate: v.saturate, hue: v.hue, blur: v.blur };
    sel.clip.filterPreset = key;
    VE.commit();
    VE.drawFrame();
    VE.renderProps();
    highlightCards();
  }

  function applyTransition(key) {
    var sel = VE.selectedClip();
    if (!sel || sel.clip.type === 'audio') { VE.toast('請先選取畫面片段'); return; }
    if (key !== 'none' && !VE.prevAdjacent(sel.track, sel.clip)) {
      VE.toast('提示：此片段前方沒有緊接的片段，轉場會從無畫面淡入');
    }
    sel.clip.transition.type = key;
    VE.commit();
    VE.renderTimeline();
    VE.drawFrame();
    VE.renderProps();
    highlightCards();
  }

  function highlightCards() {
    var sel = VE.selectedClip();
    document.querySelectorAll('#filterCards .fx-card').forEach(function (c) {
      c.classList.toggle('active', !!sel && sel.clip.filterPreset === c.dataset.filter);
    });
    document.querySelectorAll('#transitionCards .fx-card').forEach(function (c) {
      c.classList.toggle('active', !!sel && sel.clip.transition && sel.clip.transition.type === c.dataset.transition);
    });
  }

  /* ═══════════ 右側屬性面板 ═══════════ */

  var TYPE_NAME = { video: '影片片段', image: '圖片片段', audio: '音訊片段', text: '文字', sticker: '貼圖' };

  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function row(label) {
    var r = h('div', 'prop-row');
    r.appendChild(h('label', null, label));
    for (var i = 1; i < arguments.length; i++) r.appendChild(arguments[i]);
    return r;
  }

  function num(value, min, max, step, oninput, onchange) {
    var i = document.createElement('input');
    i.type = 'number';
    i.min = min; i.max = max; i.step = step;
    i.value = Math.round(value * 100) / 100;
    i.addEventListener('input', function () { if (i.value !== '') oninput(parseFloat(i.value)); });
    i.addEventListener('change', function () { (onchange || VE.commit)(); });
    return i;
  }

  function range(value, min, max, step, oninput) {
    var i = document.createElement('input');
    i.type = 'range';
    i.min = min; i.max = max; i.step = step; i.value = value;
    i.addEventListener('input', function () { oninput(parseFloat(i.value)); });
    i.addEventListener('change', function () { VE.commit(); });
    return i;
  }

  VE.renderProps = function () {
    var box = document.getElementById('props');
    if (!box) return;
    box.innerHTML = '';
    highlightCards();
    var sel = VE.selectedClip();
    if (!sel) {
      box.appendChild(h('div', 'props-empty', ''));
      box.firstChild.innerHTML = '選取時間軸上的片段<br>即可編輯屬性';
      return;
    }
    var clip = sel.clip, track = sel.track;
    var m = clip.mediaId ? VE.state.media[clip.mediaId] : null;

    box.appendChild(h('div', 'props-clipname',
      clip.type === 'text' ? '文字：' + clip.text.content.slice(0, 12) :
      clip.type === 'sticker' ? '貼圖 ' + clip.emoji :
      (m ? m.name : '片段')));
    box.appendChild(h('div', 'props-cliptype',
      TYPE_NAME[clip.type] + ' ｜ ' + VE.fmtTime(clip.start) + ' → ' + VE.fmtTime(clip.start + clip.duration) +
      '（' + clip.duration.toFixed(2) + 's）'));

    if (clip.type !== 'audio') buildTransformSection(box, clip);
    if (clip.type === 'text') buildTextSection(box, clip);
    if (clip.type === 'video' || clip.type === 'audio') {
      buildSpeedSection(box, clip, track);
      buildAudioSection(box, clip);
    }
    if (clip.type === 'video' || clip.type === 'image') buildFilterSection(box, clip);
    if (clip.type !== 'audio') buildTransitionSection(box, clip);

    /* 刪除 */
    var secDel = h('div', 'props-section');
    var delBtn = h('button', 'prop-btn', '🗑 刪除此片段');
    delBtn.style.color = 'var(--danger)';
    delBtn.onclick = function () { VE.deleteSelection(); };
    secDel.appendChild(delBtn);
    box.appendChild(secDel);
  };

  /* ── 變換 ＋ 關鍵影格 ── */
  var KF_PROPS = [
    { key: 'x', label: 'X 位置', min: -4000, max: 4000, step: 1, pct: false },
    { key: 'y', label: 'Y 位置', min: -4000, max: 4000, step: 1, pct: false },
    { key: 'scale', label: '縮放 %', min: 1, max: 5000, step: 1, pct: true },
    { key: 'rotation', label: '旋轉 °', min: -3600, max: 3600, step: 1, pct: false },
    { key: 'opacity', label: '不透明 %', min: 0, max: 100, step: 1, pct: true }
  ];

  function buildTransformSection(box, clip) {
    var sec = h('div', 'props-section');
    sec.appendChild(h('h4', null, '變換與關鍵影格'));
    KF_PROPS.forEach(function (P) {
      var tRel = VE.state.playhead - clip.start;
      var cur = VE.kfValue(clip, P.key, tRel);
      var disp = P.pct ? cur * 100 : cur;
      var input = num(disp, P.min, P.max, P.step, function (v) {
        var real = P.pct ? v / 100 : v;
        if (clip.keyframes && clip.keyframes[P.key] && clip.keyframes[P.key].length) {
          VE.kfSet(clip, P.key, VE.state.playhead - clip.start, real);
          VE.renderTimeline();
        } else {
          clip.transform[P.key] = real;
        }
        VE.drawFrame();
      });
      var kfBtn = h('button', 'kf-btn', '◆');
      updateKfBtn(kfBtn, clip, P.key);
      kfBtn.title = '在播放頭位置新增/移除關鍵影格';
      kfBtn.onclick = function () {
        var tr = VE.state.playhead - clip.start;
        if (tr < 0 || tr > clip.duration) { VE.toast('播放頭不在此片段範圍內'); return; }
        if (VE.kfAt(clip, P.key, tr)) VE.kfRemove(clip, P.key, tr);
        else VE.kfSet(clip, P.key, tr, VE.kfValue(clip, P.key, tr));
        VE.commit();
        VE.renderProps();
        VE.renderTimeline();
        VE.drawFrame();
      };
      var clr = h('button', 'kf-btn', '✕');
      clr.title = '清除此屬性所有關鍵影格';
      clr.style.display = (clip.keyframes && clip.keyframes[P.key]) ? '' : 'none';
      clr.onclick = function () {
        clip.transform[P.key] = VE.kfValue(clip, P.key, VE.state.playhead - clip.start);
        delete clip.keyframes[P.key];
        VE.commit(); VE.renderProps(); VE.renderTimeline(); VE.drawFrame();
      };
      sec.appendChild(row(P.label, input, kfBtn, clr));
    });
    sec.appendChild(h('div', 'prop-hint', '◆＝在播放頭記錄關鍵影格；有 2 個以上即形成動畫。也可直接在預覽畫面拖曳移動位置。'));
    box.appendChild(sec);
  }

  function updateKfBtn(btn, clip, prop) {
    var tRel = VE.state.playhead - clip.start;
    var has = clip.keyframes && clip.keyframes[prop] && clip.keyframes[prop].length;
    btn.classList.toggle('has-kf', !!has);
    btn.classList.toggle('at-kf', !!VE.kfAt(clip, prop, tRel));
  }

  /* ── 變速 ── */
  function buildSpeedSection(box, clip, track) {
    var sec = h('div', 'props-section');
    sec.appendChild(h('h4', null, '變速'));
    var valLabel = h('span', 'val', '×' + clip.speed);
    var slider = range(Math.log2(clip.speed), Math.log2(0.1), 3, 0.01, function (v) {
      var sp = Math.round(Math.pow(2, v) * 100) / 100;
      applySpeed(clip, track, sp);
      valLabel.textContent = '×' + sp;
    });
    sec.appendChild(row('速度', slider, valLabel));
    if (clip.type === 'video') {
      var selEl = document.createElement('select');
      Object.keys(VE.CURVES).forEach(function (k) {
        var o = document.createElement('option');
        o.value = k; o.textContent = VE.CURVES[k].name;
        if (clip.curve === k) o.selected = true;
        selEl.appendChild(o);
      });
      selEl.onchange = function () {
        clip.curve = selEl.value;
        VE.commit(); VE.drawFrame();
      };
      sec.appendChild(row('曲線', selEl));
      sec.appendChild(h('div', 'prop-hint', '曲線變速以動態播放速率近似，音訊音調會隨速度改變。'));
    }
    box.appendChild(sec);
  }

  function applySpeed(clip, track, newSpeed) {
    var srcDur = clip.duration * clip.speed;
    var newDur = srcDur / newSpeed;
    if (VE.overlaps(track, clip.start, newDur, clip.id)) {
      VE.toast('變速後長度與後方片段重疊'); return;
    }
    clip.speed = newSpeed;
    clip.duration = newDur;
    VE.renderTimeline();
    VE.drawFrame();
    VE.updateTimeLabels();
  }

  /* ── 音訊 ── */
  function buildAudioSection(box, clip) {
    var sec = h('div', 'props-section');
    sec.appendChild(h('h4', null, '音訊'));
    var valLabel = h('span', 'val', Math.round(clip.volume * 100) + '%');
    var vol = range(clip.volume, 0, 2, 0.01, function (v) {
      clip.volume = v;
      valLabel.textContent = Math.round(v * 100) + '%';
      VE.syncMedia(VE.state.playhead, VE.state.playing);
    });
    sec.appendChild(row('音量', vol, valLabel));
    var mute = document.createElement('input');
    mute.type = 'checkbox'; mute.checked = clip.muted;
    mute.onchange = function () {
      clip.muted = mute.checked;
      VE.commit();
      VE.syncMedia(VE.state.playhead, VE.state.playing);
    };
    sec.appendChild(row('靜音', mute));
    sec.appendChild(row('淡入 s', num(clip.fadeIn, 0, 30, 0.1, function (v) { clip.fadeIn = Math.max(0, v); })));
    sec.appendChild(row('淡出 s', num(clip.fadeOut, 0, 30, 0.1, function (v) { clip.fadeOut = Math.max(0, v); })));
    if (clip.type === 'video') {
      var detachBtn = h('button', 'prop-btn', '🎵 分離音訊到獨立音軌');
      detachBtn.title = '把此片段的聲音分離成獨立的音訊片段，原影片片段自動靜音';
      detachBtn.onclick = function () { VE.detachAudio(clip); };
      sec.appendChild(detachBtn);
    }
    box.appendChild(sec);
  }

  /* ── 濾鏡調整 ── */
  var FILTER_SLIDERS = [
    { key: 'brightness', label: '亮度', min: -1, max: 1, step: 0.02 },
    { key: 'contrast', label: '對比', min: -1, max: 1, step: 0.02 },
    { key: 'saturate', label: '飽和', min: -1, max: 1, step: 0.02 },
    { key: 'hue', label: '色相', min: -180, max: 180, step: 1 },
    { key: 'blur', label: '模糊', min: 0, max: 12, step: 0.5 }
  ];

  function buildFilterSection(box, clip) {
    var sec = h('div', 'props-section');
    sec.appendChild(h('h4', null, '濾鏡調整'));
    FILTER_SLIDERS.forEach(function (F) {
      var valLabel = h('span', 'val', String(clip.filter[F.key]));
      var sl = range(clip.filter[F.key], F.min, F.max, F.step, function (v) {
        clip.filter[F.key] = v;
        clip.filterPreset = 'custom';
        valLabel.textContent = String(Math.round(v * 100) / 100);
        VE.drawFrame();
        highlightCards();
      });
      sec.appendChild(row(F.label, sl, valLabel));
    });
    var reset = h('button', 'prop-btn', '重設濾鏡');
    reset.onclick = function () {
      clip.filter = { brightness: 0, contrast: 0, saturate: 0, hue: 0, blur: 0 };
      clip.filterPreset = 'none';
      VE.commit(); VE.renderProps(); VE.drawFrame();
    };
    sec.appendChild(reset);
    box.appendChild(sec);
  }

  /* ── 文字樣式 ── */
  var FONTS = [
    { name: '微軟正黑體', v: '"Microsoft JhengHei","Noto Sans TC",sans-serif' },
    { name: '標楷體', v: '"DFKai-SB","BiauKai",serif' },
    { name: '新細明體', v: '"PMingLiU",serif' },
    { name: 'Arial Black', v: '"Arial Black",sans-serif' },
    { name: 'Impact', v: 'Impact,sans-serif' },
    { name: 'Consolas', v: 'Consolas,monospace' }
  ];

  function buildTextSection(box, clip) {
    var t = clip.text;
    var sec = h('div', 'props-section');
    sec.appendChild(h('h4', null, '文字'));

    var ta = document.createElement('textarea');
    ta.value = t.content;
    ta.addEventListener('input', function () { t.content = ta.value; VE.drawFrame(); });
    ta.addEventListener('change', function () { VE.commit(); VE.renderTimeline(); });
    sec.appendChild(row('內容', ta));

    var fontSel = document.createElement('select');
    FONTS.forEach(function (f) {
      var o = document.createElement('option');
      o.value = f.v; o.textContent = f.name;
      if (t.font === f.v) o.selected = true;
      fontSel.appendChild(o);
    });
    fontSel.onchange = function () { t.font = fontSel.value; VE.commit(); VE.drawFrame(); };
    sec.appendChild(row('字體', fontSel));

    sec.appendChild(row('字級', num(t.size, 8, 400, 1, function (v) { t.size = v; VE.drawFrame(); })));

    var bold = document.createElement('input');
    bold.type = 'checkbox'; bold.checked = t.bold;
    bold.onchange = function () { t.bold = bold.checked; VE.commit(); VE.drawFrame(); };
    sec.appendChild(row('粗體', bold));

    sec.appendChild(row('顏色', color(t.color, function (v) { t.color = v; VE.drawFrame(); })));
    sec.appendChild(row('描邊色', color(t.strokeColor, function (v) { t.strokeColor = v; VE.drawFrame(); })));
    sec.appendChild(row('描邊寬', num(t.strokeWidth, 0, 30, 1, function (v) { t.strokeWidth = v; VE.drawFrame(); })));

    var bg = document.createElement('input');
    bg.type = 'checkbox'; bg.checked = t.bg;
    bg.onchange = function () { t.bg = bg.checked; VE.commit(); VE.drawFrame(); };
    sec.appendChild(row('底色', bg, color(t.bgColor, function (v) { t.bgColor = v; VE.drawFrame(); })));

    box.appendChild(sec);
  }

  function color(value, oninput) {
    var i = document.createElement('input');
    i.type = 'color'; i.value = value;
    i.addEventListener('input', function () { oninput(i.value); });
    i.addEventListener('change', function () { VE.commit(); });
    return i;
  }

  /* ── 轉場 ── */
  function buildTransitionSection(box, clip) {
    var sec = h('div', 'props-section');
    sec.appendChild(h('h4', null, '轉場（片段開頭）'));
    var selEl = document.createElement('select');
    Object.keys(TRANSITIONS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = TRANSITIONS[k].name;
      if (clip.transition.type === k) o.selected = true;
      selEl.appendChild(o);
    });
    selEl.onchange = function () {
      clip.transition.type = selEl.value;
      VE.commit(); VE.renderTimeline(); VE.drawFrame(); highlightCards();
    };
    sec.appendChild(row('類型', selEl));
    sec.appendChild(row('時長 s', num(clip.transition.dur, 0.1, 5, 0.1, function (v) {
      clip.transition.dur = VE.clamp(v, 0.1, 5); VE.drawFrame();
    })));
    box.appendChild(sec);
  }
})(window.VE);
