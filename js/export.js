/* export.js — 匯出
   優先：WebCodecs 離線快速匯出（逐幀背景編碼，無需即時播放，輸出 MP4 H.264+AAC）
   備援：canvas.captureStream + MediaRecorder 即時錄製（耗時＝影片長度） */
(function (VE) {
  'use strict';

  VE.exporting = false;

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

  function finishDownload(blob, ext) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (VE.state.project.name || '影片') + '_' + new Date().toISOString().slice(0, 10) + ext;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    setStatus('完成！已開始下載（' + (blob.size / 1048576).toFixed(1) + ' MB）', 100);
    VE.toast('匯出完成');
    setTimeout(function () { els.modal.classList.add('hidden'); }, 1800);
  }

  VE.initExport = function () {
    els.modal = document.getElementById('exportModal');
    els.info = document.getElementById('exportInfo');
    els.bar = document.getElementById('exportProgress');
    els.status = document.getElementById('exportStatus');
    els.start = document.getElementById('btnExportStart');
    els.cancel = document.getElementById('btnExportCancel');

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
        : '模式：即時錄製（耗時 ≈ 影片長度）');
    els.bar.style.width = '0%';
    els.status.textContent = '按「開始匯出」開始。';
    els.start.disabled = false;
    els.modal.classList.remove('hidden');
  }

  function startExport() {
    cancelled = false;
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
        g.gain.setValueAtTime(clip.fadeIn > 0 ? 0 : v, st);
        if (clip.fadeIn > 0) g.gain.linearRampToValueAtTime(v, st + Math.min(clip.fadeIn, clip.duration));
        if (clip.fadeOut > 0) {
          g.gain.setValueAtTime(v, Math.max(st, en - clip.fadeOut));
          g.gain.linearRampToValueAtTime(0, en);
        }
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
