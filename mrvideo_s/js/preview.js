/* preview.js — Canvas 合成渲染引擎、播放時鐘、Web Audio 混音 */
(function (VE) {
  'use strict';

  var canvas = null, ctx = null;

  VE.initPreview = function () {
    canvas = document.getElementById('previewCanvas');
    ctx = canvas.getContext('2d');
    VE.resizeCanvas();
    initCanvasDrag();
  };

  VE.getCanvas = function () { return canvas; };

  VE.resizeCanvas = function () {
    if (!canvas || !VE.state.project) return;
    var p = VE.state.project;
    if (canvas.width !== p.width) canvas.width = p.width;
    if (canvas.height !== p.height) canvas.height = p.height;
    /* 依容器等比縮放（避免直式畫布爆版） */
    canvas.style.aspectRatio = p.width + ' / ' + p.height;
  };

  /* ── 濾鏡 ── */
  function filterString(clip) {
    var f = clip.filter;
    if (!f) return '';
    var parts = [];
    if (f.brightness) parts.push('brightness(' + (1 + f.brightness).toFixed(3) + ')');
    if (f.contrast) parts.push('contrast(' + (1 + f.contrast).toFixed(3) + ')');
    if (f.saturate) parts.push('saturate(' + Math.max(0, 1 + f.saturate).toFixed(3) + ')');
    if (f.hue) parts.push('hue-rotate(' + f.hue + 'deg)');
    if (f.blur) parts.push('blur(' + f.blur + 'px)');
    return parts.join(' ');
  }

  function evalTransform(clip, t) {
    var tRel = t - clip.start;
    return {
      x: VE.kfValue(clip, 'x', tRel),
      y: VE.kfValue(clip, 'y', tRel),
      scale: VE.kfValue(clip, 'scale', tRel),
      rotation: VE.kfValue(clip, 'rotation', tRel),
      opacity: VE.kfValue(clip, 'opacity', tRel)
    };
  }

  /* ── 單一片段繪製（video/image/text/sticker） ── */
  function drawVisualClip(clip, t, alphaMul) {
    var p = VE.state.project, W = p.width, H = p.height;
    var tr = evalTransform(clip, t);
    var alpha = VE.clamp(tr.opacity * (alphaMul == null ? 1 : alphaMul), 0, 1);
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2 + tr.x, H / 2 + tr.y);
    ctx.rotate(tr.rotation * Math.PI / 180);
    var fs = filterString(clip);
    if (fs) ctx.filter = fs;

    if (clip.type === 'video') {
      var entry = VE.ensureClipEl(clip);
      if (entry && entry.el.readyState >= 2 && entry.el.videoWidth) {
        var vw = entry.el.videoWidth, vh = entry.el.videoHeight;
        var s = Math.min(W / vw, H / vh) * tr.scale;
        ctx.drawImage(entry.el, -vw * s / 2, -vh * s / 2, vw * s, vh * s);
      } else {
        drawPlaceholder(clip, W, H);
      }
    } else if (clip.type === 'image') {
      var img = VE.getImage(clip.mediaId);
      if (img) {
        var iw = img.naturalWidth, ih = img.naturalHeight;
        var si = Math.min(W / iw, H / ih) * tr.scale;
        ctx.drawImage(img, -iw * si / 2, -ih * si / 2, iw * si, ih * si);
      } else {
        drawPlaceholder(clip, W, H);
      }
    } else if (clip.type === 'text') {
      drawText(clip, tr);
    } else if (clip.type === 'sticker') {
      var size = VE.clamp(160 * tr.scale, 8, 2000);
      ctx.font = size + 'px "Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(clip.emoji || '😀', 0, 0);
    }
    ctx.restore();
  }

  function drawPlaceholder(clip, W, H) {
    var m = VE.state.media[clip.mediaId];
    ctx.fillStyle = '#20293a';
    ctx.fillRect(-W / 4, -H / 4, W / 2, H / 2);
    ctx.fillStyle = '#8b94a7';
    ctx.font = '24px "Microsoft JhengHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m && m.offline ? '素材離線' : '載入中…', 0, 0);
  }

  function drawText(clip, tr) {
    var t = clip.text;
    var size = Math.max(4, t.size * tr.scale);
    ctx.font = (t.bold ? 'bold ' : '') + size + 'px ' + t.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var lines = String(t.content || '').split('\n');
    var lh = size * 1.25;
    var totalH = lh * lines.length;
    if (t.bg) {
      var maxW = 0;
      lines.forEach(function (ln) { maxW = Math.max(maxW, ctx.measureText(ln).width); });
      var pad = size * 0.3;
      ctx.fillStyle = t.bgColor;
      ctx.globalAlpha = ctx.globalAlpha * 0.75;
      ctx.fillRect(-maxW / 2 - pad, -totalH / 2 - pad * 0.5, maxW + pad * 2, totalH + pad);
      ctx.globalAlpha = VE.clamp(tr.opacity, 0, 1);
    }
    lines.forEach(function (ln, i) {
      var y = -totalH / 2 + lh * (i + 0.5);
      if (t.strokeWidth > 0) {
        ctx.lineWidth = t.strokeWidth;
        ctx.strokeStyle = t.strokeColor;
        ctx.lineJoin = 'round';
        ctx.strokeText(ln, 0, y);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(ln, 0, y);
    });
  }

  /* ── 轉場 ── */
  function drawWithTransition(track, clip, t) {
    var trans = clip.transition;
    var td = trans ? Math.min(trans.dur, clip.duration) : 0;
    var prev = (trans && trans.type !== 'none' && td > 0) ? VE.prevAdjacent(track, clip) : null;
    if (!prev || t >= clip.start + td) {
      drawVisualClip(clip, t, 1);
      return;
    }
    var prog = VE.clamp((t - clip.start) / td, 0, 1);
    var p = VE.state.project, W = p.width, H = p.height;
    switch (trans.type) {
      case 'crossfade':
        drawVisualClip(prev, t, 1 - prog);
        drawVisualClip(clip, t, prog);
        break;
      case 'fadeblack':
        if (prog < 0.5) drawVisualClip(prev, t, 1 - prog * 2);
        else drawVisualClip(clip, t, prog * 2 - 1);
        break;
      case 'wipe':
        drawVisualClip(prev, t, 1);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W * prog, H);
        ctx.clip();
        drawVisualClip(clip, t, 1);
        ctx.restore();
        break;
      case 'slide':
        drawVisualClip(prev, t, 1);
        ctx.save();
        ctx.translate(W * (prog - 1), 0);
        drawVisualClip(clip, t, 1);
        ctx.restore();
        break;
      default:
        drawVisualClip(clip, t, 1);
    }
  }

  /* ── 匯出浮水印：只在 VE.exporting 為真時燒錄進畫面（編輯時的預覽畫布不顯示） ── */
  function drawExportWatermark(W, H) {
    var text = '影片先生 課程教學版';
    var size = Math.max(14, Math.round(W * 0.024));
    ctx.save();
    ctx.font = 'bold ' + size + 'px "Microsoft JhengHei",sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, size * 0.14);
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    var pad = Math.round(size * 0.8);
    ctx.strokeText(text, W - pad, H - pad);
    ctx.fillText(text, W - pad, H - pad);
    ctx.restore();
  }

  /* ── 整幀合成 ── */
  VE.drawFrame = function (t) {
    if (!ctx || !VE.state.project) return;
    if (t == null) t = VE.state.playhead;
    var p = VE.state.project, W = p.width, H = p.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    /* 陣列尾端（主軌/下層）先畫，索引 0（疊加層）最後畫 */
    var tracks = p.tracks;
    for (var i = tracks.length - 1; i >= 0; i--) {
      var tr = tracks[i];
      if (tr.type === 'audio' || tr.muted) continue;
      var clip = VE.clipAt(tr, t);
      if (clip) drawWithTransition(tr, clip, t);
    }
    if (VE.exporting) drawExportWatermark(W, H);
    /* 暫停時畫選取外框 */
    if (!VE.state.playing && !VE.exporting) {
      var sel = VE.selectedClip();
      if (sel && sel.clip.type !== 'audio' && t >= sel.clip.start && t < sel.clip.start + sel.clip.duration) {
        drawSelectionBox(sel.clip, t);
      }
    }
  };

  function contentSize(clip) {
    var p = VE.state.project, W = p.width, H = p.height;
    if (clip.type === 'video' || clip.type === 'image') {
      var m = VE.state.media[clip.mediaId];
      if (m && m.width) {
        var s = Math.min(W / m.width, H / m.height);
        return { w: m.width * s, h: m.height * s };
      }
      return { w: W, h: H };
    }
    if (clip.type === 'sticker') return { w: 170, h: 170 };
    if (clip.type === 'text') {
      var t = clip.text;
      ctx.font = (t.bold ? 'bold ' : '') + t.size + 'px ' + t.font;
      var lines = String(t.content || '').split('\n');
      var maxW = 10;
      lines.forEach(function (ln) { maxW = Math.max(maxW, ctx.measureText(ln).width); });
      return { w: maxW + t.size * 0.4, h: t.size * 1.25 * lines.length + t.size * 0.2 };
    }
    return { w: 100, h: 100 };
  }

  /** 選取框幾何（供繪製與滑鼠命中測試共用） */
  function selRect(clip, t) {
    var p = VE.state.project;
    var tr = evalTransform(clip, t);
    var cs = contentSize(clip);
    return {
      cx: p.width / 2 + tr.x, cy: p.height / 2 + tr.y,
      w: cs.w * tr.scale, h: cs.h * tr.scale,
      rot: tr.rotation * Math.PI / 180, scale: tr.scale
    };
  }

  function drawSelectionBox(clip, t) {
    var p = VE.state.project;
    var r = selRect(clip, t);
    var hs = Math.max(10, p.width / 90);   // 縮放握把尺寸
    ctx.save();
    ctx.translate(r.cx, r.cy);
    ctx.rotate(r.rot);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(1.5, p.width / 640);
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
    /* 右下角縮放握把 */
    ctx.setLineDash([]);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(r.w / 2 - hs / 2, r.h / 2 - hs / 2, hs, hs);
    ctx.restore();
  }

  /* ── Web Audio ── */
  VE.audioCtx = null;
  VE.masterGain = null;

  VE.initAudio = function () {
    if (VE.audioCtx) {
      if (VE.audioCtx.state === 'suspended') VE.audioCtx.resume();
      return;
    }
    try {
      VE.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      VE.masterGain = VE.audioCtx.createGain();
      VE.masterGain.connect(VE.audioCtx.destination);
      Object.keys(VE.clipEls).forEach(function (cid) {
        var found = VE.getClip(cid);
        if (found) VE.connectClipAudio(found.clip, VE.clipEls[cid]);
      });
    } catch (e) {
      console.warn('AudioContext init failed', e);
    }
  };

  VE.connectClipAudio = function (clip, entry) {
    if (!VE.audioCtx || entry.connected) return;
    if (clip.type !== 'video' && clip.type !== 'audio') return;
    try {
      entry.srcNode = VE.audioCtx.createMediaElementSource(entry.el);
      entry.gain = VE.audioCtx.createGain();
      entry.gain.gain.value = 0;
      entry.srcNode.connect(entry.gain);
      entry.gain.connect(VE.masterGain);
      entry.connected = true;
    } catch (e) {
      console.warn('connectClipAudio failed', e);
    }
  };

  var ANTI_CLICK = 0.03;   // 片段交界處最短淡入/淡出（秒），避免無淡入淡出設定時因音量瞬變產生喀聲

  function effVolume(clip, t, track) {
    if (track.muted || clip.muted) return 0;
    var v = clip.volume;
    var dt = t - clip.start;
    var rem = clip.start + clip.duration - t;
    var fi = Math.max(clip.fadeIn, ANTI_CLICK);
    var fo = Math.max(clip.fadeOut, ANTI_CLICK);
    if (dt < fi) v *= VE.clamp(dt / fi, 0, 1);
    if (rem < fo) v *= VE.clamp(rem / fo, 0, 1);
    return VE.clamp(v, 0, 2);
  }

  /* ── 媒體元素同步 ── */
  function syncMedia(t, isPlaying) {
    VE.state.project.tracks.forEach(function (track) {
      track.clips.forEach(function (clip) {
        if (clip.type !== 'video' && clip.type !== 'audio') return;
        var entry = VE.ensureClipEl(clip);
        if (!entry) return;
        var el = entry.el;
        var active = t >= clip.start && t < clip.start + clip.duration;
        if (!active) {
          if (!el.paused) el.pause();
          if (entry.gain) entry.gain.gain.value = 0;
          return;
        }
        var m = VE.state.media[clip.mediaId];
        var st = VE.sourceTime(clip, t);
        if (m && m.duration) st = VE.clamp(st, 0, Math.max(0, m.duration - 0.05));
        var tol = isPlaying ? 0.25 : 0.03;
        if (!el.seeking && Math.abs(el.currentTime - st) > tol) {
          try { el.currentTime = st; } catch (e) {}
        }
        var p = VE.clamp((t - clip.start) / clip.duration, 0, 1);
        var rate = clip.speed * VE.curveRate(clip.curve, p);
        try { el.playbackRate = VE.clamp(rate, 0.0625, 16); } catch (e) {}
        var v = effVolume(clip, t, track);
        if (entry.gain) {
          entry.gain.gain.value = v;
          el.muted = false;
        } else {
          el.volume = VE.clamp(v, 0, 1);
          el.muted = v <= 0;
        }
        if (isPlaying && el.paused) { el.play().catch(function () {}); }
        if (!isPlaying && !el.paused) el.pause();
      });
    });
  }
  VE.syncMedia = syncMedia;

  /* ── 播放時鐘 ── */
  var rafId = null, lastTs = 0;

  function updatePlayBtn() {
    var b = document.getElementById('btnPlay');
    if (b) b.textContent = VE.state.playing ? '⏸' : '▶';
  }

  VE.updateTimeLabels = function () {
    var cur = document.getElementById('timeCur');
    var tot = document.getElementById('timeTotal');
    if (cur) cur.textContent = VE.fmtTime(VE.state.playhead);
    if (tot) tot.textContent = VE.fmtTime(VE.projectDuration());
  };

  function step(ts) {
    if (!VE.state.playing) return;
    var dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    var D = VE.projectDuration();
    var t = VE.state.playhead + dt;
    if (t >= D) {
      VE.state.playhead = D;
      syncMedia(D, false);
      VE.state.playing = false;
      updatePlayBtn();
      VE.drawFrame(D);
      VE.updateTimeLabels();
      if (VE.updatePlayheadUI) VE.updatePlayheadUI();
      if (VE.onPlaybackEnd) VE.onPlaybackEnd();
      return;
    }
    VE.state.playhead = t;
    syncMedia(t, true);
    VE.drawFrame(t);
    VE.updateTimeLabels();
    if (VE.updatePlayheadUI) VE.updatePlayheadUI();
    rafId = requestAnimationFrame(step);
  }

  VE.play = function () {
    if (VE.state.playing) return;
    if (VE.projectDuration() <= 0) { VE.toast('時間軸是空的，請先加入素材'); return; }
    VE.initAudio();
    if (VE.state.playhead >= VE.projectDuration() - 0.02) VE.state.playhead = 0;
    VE.state.playing = true;
    updatePlayBtn();
    lastTs = performance.now();
    rafId = requestAnimationFrame(step);
  };

  VE.pause = function () {
    VE.state.playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    syncMedia(VE.state.playhead, false);
    updatePlayBtn();
    VE.drawFrame();
  };

  VE.togglePlay = function () {
    if (VE.state.playing) VE.pause(); else VE.play();
  };

  var redrawTimer = null;
  VE.seek = function (t) {
    var D = VE.projectDuration();
    VE.state.playhead = VE.clamp(t, 0, Math.max(D, 0));
    syncMedia(VE.state.playhead, VE.state.playing);
    VE.updateTimeLabels();
    if (VE.updatePlayheadUI) VE.updatePlayheadUI();
    if (!VE.state.playing) {
      VE.drawFrame();
      /* 影片 seek 是非同步的，延遲補畫確保顯示正確幀 */
      clearTimeout(redrawTimer);
      redrawTimer = setTimeout(function () { VE.drawFrame(); }, 120);
    }
  };

  VE.stepFrame = function (dir) {
    VE.pause();
    VE.seek(VE.state.playhead + dir / (VE.state.project.fps || 30));
  };

  /* ── 預覽畫布互動：拖曳移動、右下角握把/滾輪縮放選取片段 ── */
  function setClipProp(c, prop, v) {
    var tRel = VE.state.playhead - c.start;
    if (c.keyframes && c.keyframes[prop] && c.keyframes[prop].length) VE.kfSet(c, prop, tRel, v);
    else c.transform[prop] = v;
  }

  function initCanvasDrag() {
    var drag = null;

    function activeSelClip() {
      var sel = VE.selectedClip();
      if (!sel || sel.clip.type === 'audio') return null;
      var c = sel.clip, t = VE.state.playhead;
      if (t < c.start || t >= c.start + c.duration) return null;
      return c;
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (VE.state.playing || VE.exporting) return;
      var c = activeSelClip();
      if (!c) return;
      var rect = canvas.getBoundingClientRect();
      var scale = VE.state.project.width / rect.width;
      var t = VE.state.playhead;
      /* 指標的專案座標 */
      var px = (e.clientX - rect.left) * scale;
      var py = (e.clientY - rect.top) * scale;
      /* 右下角握把命中測試（含旋轉） */
      var r = selRect(c, t);
      var hx = r.cx + (r.w / 2) * Math.cos(r.rot) - (r.h / 2) * Math.sin(r.rot);
      var hy = r.cy + (r.w / 2) * Math.sin(r.rot) + (r.h / 2) * Math.cos(r.rot);
      var th = Math.max(14, VE.state.project.width / 70);
      var onHandle = Math.abs(px - hx) < th && Math.abs(py - hy) < th;

      if (onHandle) {
        var d0 = Math.max(4, Math.hypot(px - r.cx, py - r.cy));
        drag = { mode: 'resize', clip: c, scale: scale, cx: r.cx, cy: r.cy, d0: d0, os: r.scale };
      } else {
        drag = {
          mode: 'move', clip: c, scale: scale,
          sx: e.clientX, sy: e.clientY,
          ox: VE.kfValue(c, 'x', t - c.start),
          oy: VE.kfValue(c, 'y', t - c.start)
        };
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var c = drag.clip;
      if (drag.mode === 'move') {
        setClipProp(c, 'x', drag.ox + (e.clientX - drag.sx) * drag.scale);
        setClipProp(c, 'y', drag.oy + (e.clientY - drag.sy) * drag.scale);
      } else { /* resize：以中心距離比例縮放 */
        var rect = canvas.getBoundingClientRect();
        var px = (e.clientX - rect.left) * drag.scale;
        var py = (e.clientY - rect.top) * drag.scale;
        var d = Math.hypot(px - drag.cx, py - drag.cy);
        setClipProp(c, 'scale', VE.clamp(drag.os * d / drag.d0, 0.02, 20));
      }
      VE.drawFrame();
    });

    canvas.addEventListener('pointerup', function (e) {
      if (!drag) return;
      drag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      VE.commit();
      if (VE.renderProps) VE.renderProps();
      if (VE.renderTimeline) VE.renderTimeline();
    });

    /* 滾輪縮放選取片段（影片/圖片/文字/貼圖皆可） */
    var wheelCommit = VE.debounce(function () {
      VE.commit();
      if (VE.renderProps) VE.renderProps();
      if (VE.renderTimeline) VE.renderTimeline();
    }, 400);
    canvas.addEventListener('wheel', function (e) {
      if (VE.state.playing || VE.exporting) return;
      var c = activeSelClip();
      if (!c) return;
      e.preventDefault();
      var tRel = VE.state.playhead - c.start;
      var cur = VE.kfValue(c, 'scale', tRel);
      var f = e.deltaY < 0 ? 1.06 : 1 / 1.06;
      setClipProp(c, 'scale', VE.clamp(cur * f, 0.02, 20));
      VE.drawFrame();
      wheelCommit();
    }, { passive: false });
  }
})(window.VE);
