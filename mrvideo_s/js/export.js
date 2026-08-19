/* export.js — 匯出
   優先：WebCodecs 離線快速匯出（逐幀背景編碼，無需即時播放，輸出 MP4 H.264+AAC）
   備援：canvas.captureStream + MediaRecorder 即時錄製（耗時＝影片長度） */
(function (VE) {
  'use strict';

  VE.exporting = false;
  VE.exportWatermarkOff = false;   // 課程授權序號驗證通過時設為 true，drawExportWatermark() 據此略過浮水印

  var els = {}, cancelled = false;
  var recorder = null, chunks = [], recDest = null, progTimer = null;

  /* ══ 共用 ══ */

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function setStatus(txt, pct) {
    if (els.status) els.status.textContent = txt;
    if (els.bar && pct != null) els.bar.style.width = pct + '%';
  }

  function fastSupported() {
    return typeof VideoFrame !== 'undefined' &&
           typeof VideoEncoder !== 'undefined' &&
           typeof AudioEncoder !== 'undefined' &&
           typeof Mp4Muxer !== 'undefined';
  }

  var MIME_CANDIDATES = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4',
    'video/webm;codecs="vp9,opus"',
    'video/webm;codecs="vp8,opus"',
    'video/webm'
  ];

  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
      } catch (e) {}
    }
    return null;
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  function finishDownload(blob, ext) {
    downloadBlob(blob, (VE.state.project.name || '影片') + '_' + new Date().toISOString().slice(0, 10) + ext);
    setStatus('完成！已開始下載（' + (blob.size / 1048576).toFixed(1) + ' MB）', 100);
    VE.toast('匯出完成');
    exportExtras();
    setTimeout(function () { els.modal.classList.add('hidden'); }, 1800);
  }

  /* ══ 附加匯出：字幕 (.srt) ／音軌 (.mp3) ══ */

  function exportExtras() {
    if (els.chkSrt && els.chkSrt.checked) exportSRT();
    if (els.chkMp3 && els.chkMp3.checked) {
      exportMP3().catch(function (e) { VE.toast('MP3 匯出失敗：' + e.message); });
    }
  }

  function srtTime(t) {
    var ms = Math.max(0, Math.round(t * 1000));
    var h = Math.floor(ms / 3600000); ms -= h * 3600000;
    var m = Math.floor(ms / 60000); ms -= m * 60000;
    var s = Math.floor(ms / 1000); ms -= s * 1000;
    function pad(n, l) { return String(n).padStart(l || 2, '0'); }
    return pad(h) + ':' + pad(m) + ':' + pad(s) + ',' + pad(ms, 3);
  }

  function collectTextClips() {
    var items = [];
    VE.state.project.tracks.forEach(function (tr) {
      tr.clips.forEach(function (c) {
        if (c.type === 'text' && c.text && String(c.text.content || '').trim()) {
          items.push({ start: c.start, end: c.start + c.duration, text: c.text.content });
        }
      });
    });
    items.sort(function (a, b) { return a.start - b.start; });
    return items;
  }

  function buildSRT(items) {
    return items.map(function (it, i) {
      return (i + 1) + '\n' + srtTime(it.start) + ' --> ' + srtTime(it.end) + '\n' + it.text + '\n';
    }).join('\n');
  }

  function exportSRT() {
    var items = collectTextClips();
    if (!items.length) { VE.toast('沒有文字／字幕片段可匯出成 .srt'); return; }
    var blob = new Blob([buildSRT(items)], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, (VE.state.project.name || '影片') + '_字幕.srt');
  }

  function floatTo16(f) {
    var buf = new Int16Array(f.length);
    for (var i = 0; i < f.length; i++) {
      var s = Math.max(-1, Math.min(1, f[i]));
      buf[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return buf;
  }

  /** AudioBuffer → MP3 Blob（供匯出音軌與語音辨識共用），需要先載入 lamejs */
  function encodeMP3Blob(rendered, SR) {
    var ch0 = rendered.getChannelData(0);
    var ch1 = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : ch0;
    var encoder = new lamejs.Mp3Encoder(2, SR, 128);
    var CHUNK = 1152, L = rendered.length;
    var chunks = [];
    for (var off = 0; off < L; off += CHUNK) {
      var n = Math.min(CHUNK, L - off);
      var enc = encoder.encodeBuffer(floatTo16(ch0.subarray(off, off + n)), floatTo16(ch1.subarray(off, off + n)));
      if (enc.length) chunks.push(enc);
    }
    var end = encoder.flush();
    if (end.length) chunks.push(end);
    return new Blob(chunks, { type: 'audio/mp3' });
  }

  /** 蒐集目前時間軸上所有會發出聲音的片段（供匯出音軌／語音辨識共用） */
  function collectAudibleClips() {
    var audioClips = [];
    VE.state.project.tracks.forEach(function (tr) {
      if (tr.muted) return;
      tr.clips.forEach(function (c) {
        if ((c.type === 'audio' || c.type === 'video') && !c.muted && c.volume > 0) {
          var m = VE.state.media[c.mediaId];
          if (m && m.url) audioClips.push({ clip: c, media: m });
        }
      });
    });
    return audioClips;
  }

  async function exportMP3() {
    if (typeof lamejs === 'undefined') throw new Error('MP3 編碼器載入失敗，請檢查網路連線後重新整理頁面');
    var p = VE.state.project, D = VE.projectDuration();
    var audioClips = collectAudibleClips();
    if (!audioClips.length) throw new Error('沒有可匯出的音軌');
    var SR = 48000;
    var rendered = await renderAudio(audioClips, D, SR);
    downloadBlob(encodeMP3Blob(rendered, SR), (p.name || '影片') + '_音軌.mp3');
  }

  var GEMINI_MODEL = 'gemini-3.5-flash';

  /** Blob → base64 字串（供 Gemini inline_data 使用，分塊轉換避免大檔案時 apply() 爆堆疊） */
  function blobToBase64(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var chunk = 0x8000, binary = '';
      for (var i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    });
  }

  /* ══ 語音轉字幕（選用，需自備 API 金鑰＋課程授權序號） ══
     混音 → 編碼成 mp3 → 送辨識服務並取得逐句時間戳記 → 回傳 [{start,end,text}]
     由呼叫端（panels.js）負責先驗證課程授權序號、再把結果交給 VE.addTranscriptSegments()
     生成文字片段，這裡只做「聲音變文字」，不碰時間軸狀態、不碰序號驗證。
     支援兩個服務商（Claude 目前 API 不支援音訊輸入、OpenRouter 各模型音訊支援不一，故不提供）：
     - Gemini：多模態模型，時間戳記為模型自行估算，精確度不如專門的語音辨識服務，上限 15MB（base64 膨脹更保守）。
     - OpenAI Whisper：專用語音辨識端點，回傳原生對齊的逐句時間戳記（verbose_json 的 segments），精確度較高，上限 25MB（二進位直傳無膨脹）。 */
  async function transcribeWithGemini(apiKey, blob, onProgress) {
    if (blob.size > 15 * 1024 * 1024) {
      throw new Error('混音後的音訊約 ' + (blob.size / 1048576).toFixed(0) + 'MB，超過 Gemini 辨識上限（15MB），請縮短時間軸長度，或改用 OpenAI Whisper（上限 25MB）');
    }

    if (onProgress) onProgress('轉換音訊格式中…');
    var base64 = await blobToBase64(blob);

    if (onProgress) onProgress('上傳辨識中（依片長可能需要數十秒）…');
    var prompt = '請將這段音訊裡的講話內容逐句轉錄成繁體中文文字，並標出每一句相對音訊開頭的開始與結束秒數（數字，可含小數）。' +
      '只回傳一個 JSON 陣列，每個元素格式為 {"start":數字,"end":數字,"text":"文字"}，依時間先後排序，不要任何其他文字、說明或 markdown 標記。' +
      '如果完全沒有講話內容，回傳空陣列 []。';
    var resp;
    try {
      resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'audio/mp3', data: base64 } }] }]
        })
      });
    } catch (e) {
      throw new Error('無法連線至 Gemini，請檢查網路連線');
    }
    if (!resp.ok) {
      var msg = resp.status;
      try { var errBody = await resp.json(); msg = (errBody.error && errBody.error.message) || msg; } catch (e) {}
      throw new Error('辨識失敗（' + msg + '）');
    }
    var data = await resp.json();
    var text = ((((data.candidates || [])[0] || {}).content || {}).parts || [])
      .map(function (p) { return p.text || ''; }).join('');
    var m = text.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Gemini 回應中找不到辨識結果');
    var raw;
    try { raw = JSON.parse(m[0]); } catch (e) { throw new Error('Gemini 回應格式無法解析'); }
    var segments = raw.map(function (s) {
      return { start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() };
    }).filter(function (s) { return s.text && s.end > s.start; });
    if (!segments.length) throw new Error('沒有辨識到任何講話內容');
    segments.sort(function (a, b) { return a.start - b.start; });
    return segments;
  }

  async function transcribeWithOpenAI(apiKey, blob, onProgress) {
    if (blob.size > 25 * 1024 * 1024) {
      throw new Error('混音後的音訊約 ' + (blob.size / 1048576).toFixed(0) + 'MB，超過 OpenAI Whisper 辨識上限（25MB），請縮短時間軸長度');
    }

    if (onProgress) onProgress('上傳辨識中（依片長可能需要數十秒）…');
    var form = new FormData();
    form.append('file', blob, 'audio.mp3');
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    var resp;
    try {
      resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey },
        body: form
      });
    } catch (e) {
      throw new Error('無法連線至 OpenAI，請檢查網路連線');
    }
    if (!resp.ok) {
      var msg = resp.status;
      try { var errBody = await resp.json(); msg = (errBody.error && errBody.error.message) || msg; } catch (e) {}
      throw new Error('辨識失敗（' + msg + '）');
    }
    var data = await resp.json();
    var segments = (data.segments || []).map(function (s) {
      return { start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() };
    }).filter(function (s) { return s.text && s.end > s.start; });
    if (!segments.length) throw new Error('沒有辨識到任何講話內容');
    segments.sort(function (a, b) { return a.start - b.start; });
    return segments;
  }

  VE.transcribeSpeech = async function (provider, apiKey, onProgress) {
    if (typeof lamejs === 'undefined') throw new Error('MP3 編碼器載入失敗，請檢查網路連線後重新整理頁面');
    if (!apiKey) throw new Error('請先在左側「⚙️設定」填入 API 金鑰');
    var D = VE.projectDuration();
    var audioClips = collectAudibleClips();
    if (!audioClips.length) throw new Error('時間軸上沒有可辨識的音訊');

    if (onProgress) onProgress('混音中…');
    var SR = 44100;
    var rendered = await renderAudio(audioClips, D, SR);
    var blob = encodeMP3Blob(rendered, SR);

    return provider === 'openai' ? transcribeWithOpenAI(apiKey, blob, onProgress) : transcribeWithGemini(apiKey, blob, onProgress);
  };

  VE.initExport = function () {
    els.modal = document.getElementById('exportModal');
    els.info = document.getElementById('exportInfo');
    els.bar = document.getElementById('exportProgress');
    els.status = document.getElementById('exportStatus');
    els.start = document.getElementById('btnExportStart');
    els.cancel = document.getElementById('btnExportCancel');
    els.chkSrt = document.getElementById('chkExportSrt');
    els.chkMp3 = document.getElementById('chkExportMp3');

    document.getElementById('btnExport').addEventListener('click', openModal);
    els.start.addEventListener('click', startExport);
    els.cancel.addEventListener('click', function () {
      if (VE.exporting) {
        cancelled = true;
        VE.pause();
        VE.onPlaybackEnd = null;
        try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) {}
        clearInterval(progTimer);
      } else {
        els.modal.classList.add('hidden');
      }
    });
  };

  function openModal() {
    var D = VE.projectDuration();
    if (D <= 0) { VE.toast('時間軸是空的，沒有內容可匯出'); return; }
    var fast = fastSupported();
    if (!fast && !pickMime()) {
      VE.toast('此瀏覽器不支援影片匯出，請改用 Chrome / Edge');
      return;
    }
    VE.pause();
    var p = VE.state.project;
    els.info.innerHTML =
      '解析度：' + p.width + ' × ' + p.height + '　影格率：' + p.fps + ' fps<br>' +
      '長度：' + VE.fmtTime(D) + '<br>' +
      (fast
        ? '模式：⚡ 快速匯出 MP4（背景編碼，<b>無需播放</b>，速度快）'
        : '模式：即時錄製（耗時 ≈ 影片長度）') +
      '<br>浮水印：<span id="wmStatus">檢查課程授權序號中…</span>';
    els.bar.style.width = '0%';
    els.status.textContent = '按「開始匯出」開始。';
    els.start.disabled = false;
    els.modal.classList.remove('hidden');
    refreshWatermarkStatus();
  }

  var WM_ON_LABEL = '含「馬克老師AI」浮水印（頂部輸入課程授權序號並驗證通過可移除）';
  var WM_OFF_LABEL = '✓ 已驗證課程授權序號，匯出不含浮水印';

  /** 即時重新檢查課程授權序號，決定這次匯出要不要加浮水印（跟語音轉字幕一樣，每次都重新驗證、不信任本機快取） */
  function refreshWatermarkStatus() {
    VE.exportWatermarkOff = false;   // 驗證確認通過前，保守顯示浮水印
    var el = document.getElementById('wmStatus');
    return VE.runLicenseCheck({ silent: true }).then(function (license) {
      VE.exportWatermarkOff = !!license.valid;
      if (el) el.textContent = VE.exportWatermarkOff ? WM_OFF_LABEL : WM_ON_LABEL;
      return VE.exportWatermarkOff;
    });
  }

  function startExport() {
    cancelled = false;
    VE.exporting = true;   // 提前設定，讓「確認課程授權序號」期間按下取消也能被 Cancel 按鈕的既有邏輯正確攔截
    els.start.disabled = true;
    setStatus('確認課程授權序號中…', 0);
    refreshWatermarkStatus().then(function () {
      if (cancelled) {
        VE.exporting = false;
        els.start.disabled = false;
        setStatus('已取消', 0);
        els.modal.classList.add('hidden');
        return;
      }
      if (fastSupported()) {
        fastExport().catch(function (e) {
          VE.exporting = false;
          els.start.disabled = false;
          if (cancelled) {
            setStatus('已取消', 0);
            els.modal.classList.add('hidden');
            return;
          }
          console.error('fast export failed', e);
          VE.toast('快速匯出失敗（' + e.message + '），改用即時錄製');
          realtimeExport();
        });
      } else {
        realtimeExport();
      }
    });
  }

  /* ══ 方案一：WebCodecs 離線快速匯出（無需播放） ══ */

  var decodeCache = {};

  function decodeMedia(m, ctx) {
    if (decodeCache[m.id]) return decodeCache[m.id];
    decodeCache[m.id] = fetch(m.url)
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return ctx.decodeAudioData(ab); });
    return decodeCache[m.id];
  }

  var ANTI_CLICK = 0.005;   // 片段交界最短淡入/淡出（秒），避免無淡入淡出設定時因音量瞬變產生喀聲

  /** 以 OfflineAudioContext 混出整條音軌（含音量/淡入淡出/變速） */
  function renderAudio(items, D, SR) {
    var ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(D * SR)), SR);
    var jobs = items.map(function (it) {
      var clip = it.clip;
      return decodeMedia(it.media, ctx).then(function (buf) {
        var src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = clip.speed;   // 曲線變速以平均速率近似
        var g = ctx.createGain();
        var v = VE.clamp(clip.volume, 0, 2);
        var st = Math.max(0, clip.start), en = clip.start + clip.duration;
        var fi = Math.min(Math.max(clip.fadeIn, ANTI_CLICK), clip.duration / 2);
        var fo = Math.min(Math.max(clip.fadeOut, ANTI_CLICK), clip.duration / 2);
        g.gain.setValueAtTime(0, st);
        g.gain.linearRampToValueAtTime(v, st + fi);
        g.gain.setValueAtTime(v, Math.max(st + fi, en - fo));
        g.gain.linearRampToValueAtTime(0, en);
        src.connect(g);
        g.connect(ctx.destination);
        var off = VE.clamp(clip.in, 0, buf.duration);
        var dur = Math.min(clip.duration * clip.speed, buf.duration - off);
        if (dur > 0) src.start(st, off, dur);
      }).catch(function () { /* 無音軌的影片等，直接略過 */ });
    });
    return Promise.all(jobs).then(function () { return ctx.startRendering(); });
  }

  /** 把 t 時刻會出現在畫面上的影片元素 seek 到正確幀（含轉場需要的前段凍結幀） */
  function seekVisualsTo(t) {
    var waits = [];
    VE.state.project.tracks.forEach(function (tr) {
      if (tr.type === 'audio' || tr.muted) return;
      tr.clips.forEach(function (clip) {
        if (clip.type !== 'video') return;
        if (t < clip.start - 0.05 || t > clip.start + clip.duration + 1) return;
        var entry = VE.ensureClipEl(clip);
        if (!entry) return;
        var el = entry.el;
        var st = VE.sourceTime(clip, Math.min(t, clip.start + clip.duration));
        var m = VE.state.media[clip.mediaId];
        if (m && m.duration) st = VE.clamp(st, 0, Math.max(0, m.duration - 0.05));
        if (el.readyState >= 1 && Math.abs(el.currentTime - st) > 0.005) {
          waits.push(new Promise(function (res) {
            var tm = setTimeout(done, 300);
            function done() {
              clearTimeout(tm);
              el.removeEventListener('seeked', done);
              res();
            }
            el.addEventListener('seeked', done);
            try { el.currentTime = st; } catch (e) { done(); }
          }));
        }
      });
    });
    return Promise.all(waits);
  }

  function preloadImages() {
    var ps = [];
    VE.state.project.tracks.forEach(function (tr) {
      tr.clips.forEach(function (clip) {
        if (clip.type !== 'image') return;
        var m = VE.state.media[clip.mediaId];
        if (!m || !m.url) return;
        var img = VE.imgCache[m.id];
        if (!img) {
          img = new Image();
          img.src = m.url;
          VE.imgCache[m.id] = img;
        }
        if (!img.complete) {
          ps.push(new Promise(function (res) { img.onload = res; img.onerror = res; }));
        }
      });
    });
    return Promise.all(ps);
  }

  async function fastExport() {
    var p = VE.state.project, D = VE.projectDuration(), fps = p.fps || 30;
    VE.exporting = true;
    VE.pause();
    els.start.disabled = true;
    decodeCache = {};
    setStatus('準備編碼器…', 1);

    try {
      /* 蒐集要混音的片段 */
      var audioClips = [];
      p.tracks.forEach(function (tr) {
        if (tr.muted) return;
        tr.clips.forEach(function (c) {
          if ((c.type === 'audio' || c.type === 'video') && !c.muted && c.volume > 0) {
            var m = VE.state.media[c.mediaId];
            if (m && m.url) audioClips.push({ clip: c, media: m });
          }
        });
      });

      var SR = 48000;
      var hasAudio = audioClips.length > 0;
      var audioCodec = null;
      if (hasAudio) {
        var aac = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 192000 });
        if (aac.supported) audioCodec = 'aac';
        else {
          var opus = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: SR, numberOfChannels: 2, bitrate: 128000 });
          if (opus.supported) audioCodec = 'opus';
          else hasAudio = false;
        }
      }

      var vCodec = 'avc1.42001f';
      var vc = await VideoEncoder.isConfigSupported({ codec: vCodec, width: p.width, height: p.height, framerate: fps });
      if (!vc.supported) {
        vCodec = 'avc1.640028';
        vc = await VideoEncoder.isConfigSupported({ codec: vCodec, width: p.width, height: p.height, framerate: fps });
        if (!vc.supported) throw new Error('此瀏覽器不支援 H.264 編碼');
      }

      var muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width: p.width, height: p.height },
        audio: hasAudio ? { codec: audioCodec, sampleRate: SR, numberOfChannels: 2 } : undefined,
        fastStart: 'in-memory'
      });

      /* 音訊：離線混音 → 編碼 */
      if (hasAudio) {
        setStatus('混音中…', 3);
        var rendered = await renderAudio(audioClips, D, SR);
        if (cancelled) throw new Error('cancelled');
        setStatus('編碼音訊…', 6);
        var aErr = null;
        var aenc = new AudioEncoder({
          output: function (chunk, meta) { muxer.addAudioChunk(chunk, meta); },
          error: function (e) { aErr = e; }
        });
        aenc.configure({
          codec: audioCodec === 'aac' ? 'mp4a.40.2' : 'opus',
          sampleRate: SR, numberOfChannels: 2,
          bitrate: audioCodec === 'aac' ? 192000 : 128000
        });
        var ch0 = rendered.getChannelData(0);
        var ch1 = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : ch0;
        var CHUNK = 4800, L = rendered.length;
        for (var off = 0; off < L; off += CHUNK) {
          if (cancelled) throw new Error('cancelled');
          var n = Math.min(CHUNK, L - off);
          var data = new Float32Array(n * 2);
          data.set(ch0.subarray(off, off + n), 0);
          data.set(ch1.subarray(off, off + n), n);
          var ad = new AudioData({
            format: 'f32-planar', sampleRate: SR,
            numberOfFrames: n, numberOfChannels: 2,
            timestamp: Math.round(off / SR * 1e6), data: data
          });
          aenc.encode(ad);
          ad.close();
          if (aErr) throw aErr;
        }
        await aenc.flush();
        aenc.close();
      }

      /* 畫面：逐幀 seek → 合成 → 編碼 */
      await preloadImages();
      var vErr = null;
      var venc = new VideoEncoder({
        output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
        error: function (e) { vErr = e; }
      });
      venc.configure({ codec: vCodec, width: p.width, height: p.height, bitrate: 8000000, framerate: fps });

      var total = Math.max(1, Math.ceil(D * fps));
      var us = 1e6 / fps;
      var t0 = performance.now();
      for (var i = 0; i < total; i++) {
        if (cancelled) throw new Error('cancelled');
        var t = i / fps;
        await seekVisualsTo(t);
        VE.drawFrame(t);
        var frame = new VideoFrame(VE.getCanvas(), { timestamp: Math.round(i * us), duration: Math.round(us) });
        venc.encode(frame, { keyFrame: i % (fps * 4) === 0 });
        frame.close();
        if (vErr) throw vErr;
        if (venc.encodeQueueSize > 8) await sleep(8);
        if (i % 15 === 0) {
          var elapsed = (performance.now() - t0) / 1000;
          var eta = i > 0 ? Math.ceil(elapsed / i * (total - i)) : 0;
          setStatus('編碼畫面… ' + Math.round(i / total * 100) + '%（剩餘約 ' + eta + ' 秒）',
                    8 + Math.round(i / total * 90));
          await sleep(0);
        }
      }
      await venc.flush();
      venc.close();

      muxer.finalize();
      var blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      finishDownload(blob, '.mp4');
    } finally {
      decodeCache = {};
      VE.exporting = false;
      els.start.disabled = false;
      VE.seek(VE.state.playhead);   // 讓預覽回到正確狀態
    }
  }

  /* ══ 方案二：MediaRecorder 即時錄製（備援） ══ */

  function realtimeExport() {
    var mime = pickMime();
    if (!mime) { VE.toast('此瀏覽器不支援 MediaRecorder'); return; }
    var p = VE.state.project;
    var D = VE.projectDuration();

    VE.initAudio();
    if (!VE.audioCtx) { VE.toast('音訊初始化失敗'); return; }
    if (!recDest) {
      recDest = VE.audioCtx.createMediaStreamDestination();
      VE.masterGain.connect(recDest);
    }

    var canvasStream = VE.getCanvas().captureStream(p.fps);
    var stream = new MediaStream(
      canvasStream.getVideoTracks().concat(recDest.stream.getAudioTracks())
    );

    chunks = [];
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
    } catch (e) {
      VE.toast('無法建立錄製器：' + e.message);
      return;
    }
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = function () {
      clearInterval(progTimer);
      VE.exporting = false;
      VE.onPlaybackEnd = null;
      els.start.disabled = false;
      if (cancelled) {
        chunks = [];
        setStatus('已取消', 0);
        els.modal.classList.add('hidden');
        return;
      }
      var blob = new Blob(chunks, { type: mime.split(';')[0] });
      chunks = [];
      finishDownload(blob, mime.indexOf('mp4') >= 0 ? '.mp4' : '.webm');
    };

    VE.exporting = true;
    els.start.disabled = true;
    setStatus('即時錄製中… 0%', 0);

    VE.pause();
    VE.seek(0);
    VE.onPlaybackEnd = function () {
      setStatus('封裝檔案中…', 99);
      try { recorder.stop(); } catch (e) {}
    };
    setTimeout(function () {
      recorder.start(500);
      VE.play();
      progTimer = setInterval(function () {
        var pct = Math.min(100, Math.round(VE.state.playhead / D * 100));
        setStatus('即時錄製中… ' + pct + '%（剩餘約 ' + Math.max(0, Math.ceil(D - VE.state.playhead)) + ' 秒）', pct);
      }, 300);
    }, 250);
  }
})(window.VE);
