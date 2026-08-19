/* timeline.js — 多軌時間軸：渲染、拖曳、裁切、分割、縮放、吸附 */
(function (VE) {
  'use strict';

  var RULER_H = 28;
  function rowH(track) { return track.type === 'video' ? 64 : 48; }
  function pps() { return VE.state.pxPerSec; }

  var TRACK_ICON = { video: '🎞', audio: '🎵', overlay: '✨' };
  var els = {};

  VE.initTimeline = function () {
    els.heads = document.getElementById('tlHeads');
    els.body = document.getElementById('tlBody');
    els.content = document.getElementById('tlContent');
    els.area = document.getElementById('tracksArea');
    els.ruler = document.getElementById('ruler');
    els.playhead = document.getElementById('playhead');

    els.ruler.style.position = 'sticky';
    els.ruler.style.left = '0';
    els.ruler.style.top = '0';
    els.ruler.style.zIndex = '8';
    els.ruler.style.background = 'var(--panel)';

    els.body.addEventListener('scroll', drawRuler);
    window.addEventListener('resize', function () { drawRuler(); });

    /* 尺規 seek */
    els.ruler.addEventListener('pointerdown', function (e) {
      VE.pause();
      seekFromEvent(e);
      try { els.ruler.setPointerCapture(e.pointerId); } catch (err) {}
      var move = function (ev) { seekFromEvent(ev); };
      var up = function () {
        els.ruler.removeEventListener('pointermove', move);
        els.ruler.removeEventListener('pointerup', up);
      };
      els.ruler.addEventListener('pointermove', move);
      els.ruler.addEventListener('pointerup', up);
    });

    document.getElementById('zoomSlider').addEventListener('input', function (e) {
      VE.state.pxPerSec = +e.target.value;
      VE.renderTimeline();
    });
    document.getElementById('chkSnap').addEventListener('change', function (e) {
      VE.state.snap = e.target.checked;
    });
    document.getElementById('btnSplit').addEventListener('click', function () { VE.splitAtPlayhead(); });
    document.getElementById('btnDelete').addEventListener('click', function () { VE.deleteSelection(); });
    document.getElementById('btnUndo2').addEventListener('click', function () { VE.undo(); });
    document.getElementById('btnRedo2').addEventListener('click', function () { VE.redo(); });

    /* 新增軌道 */
    document.getElementById('addTrackSel').addEventListener('change', function (e) {
      var v = e.target.value;
      e.target.value = '';
      if (!v) return;
      var p = VE.state.project;
      var names = { audio: '音訊', video: '畫中畫', overlay: '文字 / 貼圖' };
      var count = p.tracks.filter(function (t) { return t.type === v; }).length;
      var tr = VE.newTrack(v, names[v] + ' ' + (count + 1));
      if (v === 'audio') p.tracks.push(tr);                 // 音訊軌加在最下面
      else if (v === 'overlay') p.tracks.unshift(tr);       // 疊加軌加在最上面
      else {                                                 // 畫中畫軌插在最上層影片軌之前
        var idx = -1;
        for (var i = 0; i < p.tracks.length; i++) {
          if (p.tracks[i].type === 'video') { idx = i; break; }
        }
        if (idx < 0) idx = p.tracks.length - 1;
        p.tracks.splice(idx, 0, tr);
      }
      VE.commit();
      VE.refreshAll();
      VE.toast('已新增「' + tr.name + '」軌道');
    });
  };

  function seekFromEvent(e) {
    var rect = els.content.getBoundingClientRect();
    VE.seek((e.clientX - rect.left) / pps());
  }

  /* ── 吸附 ── */
  function snapTime(t, excludeId) {
    if (!VE.state.snap) return Math.max(0, t);
    var cands = [0, VE.state.playhead];
    VE.state.project.tracks.forEach(function (tr) {
      tr.clips.forEach(function (c) {
        if (c.id === excludeId) return;
        cands.push(c.start, c.start + c.duration);
      });
    });
    var th = 8 / pps(), best = t, bd = th;
    cands.forEach(function (c) {
      var d = Math.abs(c - t);
      if (d < bd) { bd = d; best = c; }
    });
    return Math.max(0, best);
  }

  /* ── 渲染 ── */
  VE.renderTimeline = function () {
    if (!els.area) return;
    var p = VE.state.project;

    /* 軌道標頭 */
    els.heads.innerHTML = '';
    var sp = document.createElement('div');
    sp.className = 'tl-head-spacer';
    els.heads.appendChild(sp);
    p.tracks.forEach(function (tr) {
      var h = document.createElement('div');
      h.className = 'tl-head';
      h.style.height = rowH(tr) + 'px';
      h.title = '拖曳可上下調整圖層順序（清單越上面＝畫面越上層）';
      h.addEventListener('pointerdown', function (e) {
        if (e.target.tagName === 'BUTTON') return;
        startHeadDrag(e, tr);
      });
      var mute = document.createElement('button');
      mute.className = 'th-mute' + (tr.muted ? ' on' : '');
      mute.textContent = tr.muted ? '🔇' : '🔊';
      mute.title = tr.muted ? '取消靜音/隱藏' : '靜音/隱藏此軌';
      mute.onclick = function () {
        tr.muted = !tr.muted;
        VE.commit(); VE.renderTimeline(); VE.drawFrame();
      };
      var name = document.createElement('span');
      name.className = 'th-name';
      name.textContent = (TRACK_ICON[tr.type] || '') + ' ' + tr.name;
      h.appendChild(mute); h.appendChild(name);
      /* 空的非主軌可刪除 */
      if (!tr.main && tr.clips.length === 0 && p.tracks.length > 1) {
        var del = document.createElement('button');
        del.className = 'th-mute';
        del.textContent = '✕';
        del.title = '刪除此空軌道';
        del.onclick = function () {
          p.tracks = p.tracks.filter(function (t) { return t !== tr; });
          VE.commit(); VE.refreshAll();
        };
        h.appendChild(del);
      }
      els.heads.appendChild(h);
    });

    /* 內容寬度 */
    var dur = Math.max(VE.projectDuration() + 5, 30);
    var width = Math.max(dur * pps() + 200, els.body.clientWidth || 600);
    els.content.style.width = width + 'px';

    /* 軌道列 */
    els.area.innerHTML = '';
    p.tracks.forEach(function (tr) {
      var row = document.createElement('div');
      row.className = 'track-row';
      row.style.height = rowH(tr) + 'px';
      row.dataset.trackId = tr.id;
      row.dataset.trackType = tr.type;

      tr.clips.forEach(function (clip) { row.appendChild(buildClipEl(tr, clip)); });

      /* 點空白處：seek + 取消選取 */
      row.addEventListener('pointerdown', function (e) {
        if (e.target !== row) return;
        var rect = row.getBoundingClientRect();
        VE.pause();
        VE.seek((e.clientX - rect.left) / pps());
        VE.state.selection = null;
        VE.renderProps();
        VE.renderTimeline();
      });

      /* 從素材庫拖放（帶落點幽靈預覽） */
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        var m = VE.dragMedia;
        if (!m) { row.classList.add('drag-over'); return; }
        var compatible = mediaCompatible(m, tr);
        var rect = row.getBoundingClientRect();
        var dur = m.type === 'image' ? 4 : (m.duration || 3);
        var t = snapTime((e.clientX - rect.left) / pps(), null);
        /* 不相容＝紅色；重疊＝琥珀色（放開時會自動疊到新軌道） */
        showGhost(row, t, dur, compatible, compatible && VE.overlaps(tr, t, dur, null));
      });
      row.addEventListener('dragleave', function (e) {
        row.classList.remove('drag-over');
        if (e.target === row) hideGhost();
      });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('drag-over');
        hideGhost();
        var data = e.dataTransfer.getData('text/plain') || '';
        if (data.indexOf('media:') !== 0) return;
        e.stopPropagation();
        var mediaId = data.slice(6);
        var m = VE.state.media[mediaId];
        if (!m) return;
        var compatible = mediaCompatible(m, tr);
        var rect = row.getBoundingClientRect();
        var t = snapTime((e.clientX - rect.left) / pps(), null);
        VE.addMediaToTimeline(mediaId, t, compatible ? tr.id : null);
        VE.clearDragState();
      });

      els.area.appendChild(row);
    });

    drawRuler();
    VE.updatePlayheadUI();
    VE.updateTimeLabels();
  };

  function buildClipEl(track, clip) {
    var el = document.createElement('div');
    el.className = 'clip c-' + clip.type + (VE.state.selection === clip.id ? ' selected' : '');
    el.style.left = (clip.start * pps()) + 'px';
    el.style.width = Math.max(6, clip.duration * pps()) + 'px';
    el.dataset.clipId = clip.id;

    var m = clip.mediaId ? VE.state.media[clip.mediaId] : null;
    if ((clip.type === 'video' || clip.type === 'image') && m && m.thumb) {
      var th = document.createElement('div');
      th.className = 'clip-thumb';
      th.style.backgroundImage = 'url(' + m.thumb + ')';
      el.appendChild(th);
    }

    var label = document.createElement('span');
    label.className = 'clip-label';
    if (clip.type === 'text') label.textContent = '🅣 ' + (clip.text.content || '');
    else if (clip.type === 'sticker') label.textContent = clip.emoji;
    else label.textContent = (m ? m.name : '？') + (clip.speed !== 1 ? ' ×' + clip.speed : '');
    el.appendChild(label);

    if (clip.transition && clip.transition.type !== 'none') {
      var tb = document.createElement('div');
      tb.className = 'trans-badge';
      tb.textContent = '⇄';
      el.appendChild(tb);
    }

    /* 關鍵影格菱形 */
    var kfTimes = {};
    Object.keys(clip.keyframes || {}).forEach(function (prop) {
      clip.keyframes[prop].forEach(function (k) { kfTimes[k.t.toFixed(2)] = k.t; });
    });
    var kfKeys = Object.keys(kfTimes);
    if (kfKeys.length) {
      var marks = document.createElement('div');
      marks.className = 'kf-marks';
      kfKeys.forEach(function (k) {
        var mk = document.createElement('div');
        mk.className = 'kf-mark';
        mk.style.left = (kfTimes[k] / clip.duration * 100) + '%';
        marks.appendChild(mk);
      });
      el.appendChild(marks);
    }

    var trimL = document.createElement('div');
    trimL.className = 'trim l';
    var trimR = document.createElement('div');
    trimR.className = 'trim r';
    el.appendChild(trimL); el.appendChild(trimR);

    el.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      VE.pause();
      if (VE.state.selection !== clip.id) {
        VE.state.selection = clip.id;
        VE.renderProps();
        /* 只更新選取樣式，不整個重繪（保住 pointer capture） */
        document.querySelectorAll('.clip.selected').forEach(function (c) { c.classList.remove('selected'); });
        el.classList.add('selected');
        VE.drawFrame();
      }
      var mode = e.target === trimL ? 'trim-l' : e.target === trimR ? 'trim-r' : 'move';
      startDrag(e, el, track, clip, mode);
    });

    return el;
  }

  /* ── 片段拖曳 / 裁切 ── */
  function startDrag(e, el, track, clip, mode) {
    var orig = { start: clip.start, dur: clip.duration, in: clip.in };
    var m = clip.mediaId ? VE.state.media[clip.mediaId] : null;
    var startX = e.clientX;
    var pending = { start: orig.start, dur: orig.dur, in: orig.in, track: track };
    var moved = false;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}

    function onMove(ev) {
      var dx = (ev.clientX - startX) / pps();
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      if (!moved) return;

      if (mode === 'move') {
        var ns = orig.start + dx;
        var snapped = snapTime(ns, clip.id);
        if (Math.abs(snapped - ns) < 8 / pps()) ns = snapped;
        else {
          var endSnap = snapTime(ns + orig.dur, clip.id);
          if (Math.abs(endSnap - (ns + orig.dur)) < 8 / pps()) ns = endSnap - orig.dur;
        }
        pending.start = Math.max(0, ns);
        el.style.left = (pending.start * pps()) + 'px';
        /* 跨軌拖曳：找目前指到的相容軌道 */
        var rows = document.elementsFromPoint(ev.clientX, ev.clientY);
        document.querySelectorAll('.track-row.drag-over').forEach(function (r) { r.classList.remove('drag-over'); });
        for (var i = 0; i < rows.length; i++) {
          if (!rows[i].classList || !rows[i].classList.contains('track-row')) continue;
          var tid = rows[i].dataset.trackId;
          var target = null;
          VE.state.project.tracks.forEach(function (tr) { if (tr.id === tid) target = tr; });
          if (target && compatibleTrack(clip, target)) {
            pending.track = target;
            if (target !== track) {
              rows[i].classList.add('drag-over');
              /* 視覺上跟著移到目標軌道 */
              el.style.transform = 'translateY(' + (rows[i].offsetTop - el.parentNode.offsetTop) + 'px)';
              el.style.zIndex = 30;
            } else {
              el.style.transform = '';
            }
          }
          break;
        }
      } else if (mode === 'trim-l') {
        var minDx = -orig.start;
        if (clip.type === 'video' || clip.type === 'audio') {
          minDx = Math.max(minDx, -orig.in / clip.speed);
        }
        var d = VE.clamp(dx, minDx, orig.dur - 0.1);
        var snappedS = snapTime(orig.start + d, clip.id);
        if (Math.abs(snappedS - (orig.start + d)) < 8 / pps()) d = snappedS - orig.start;
        d = VE.clamp(d, minDx, orig.dur - 0.1);
        pending.start = orig.start + d;
        pending.dur = orig.dur - d;
        pending.in = orig.in + d * clip.speed;
        pending.trimDelta = d;
        el.style.left = (pending.start * pps()) + 'px';
        el.style.width = Math.max(6, pending.dur * pps()) + 'px';
      } else { /* trim-r */
        var maxDur = Infinity;
        if ((clip.type === 'video' || clip.type === 'audio') && m && m.duration) {
          /* 用 rawDuration（偵測修正前的原始容器時長）當延伸上限，不是修正後的 m.duration——
             這樣如果自動偵測誤判把片段長度修短了，使用者仍可手動拖曳邊緣拉回被裁掉的部分 */
          maxDur = ((m.rawDuration || m.duration) - orig.in) / clip.speed;
        }
        var nd = VE.clamp(orig.dur + dx, 0.1, maxDur);
        var snappedE = snapTime(orig.start + nd, clip.id);
        if (Math.abs(snappedE - (orig.start + nd)) < 8 / pps()) nd = snappedE - orig.start;
        nd = VE.clamp(nd, 0.1, maxDur);
        pending.dur = nd;
        el.style.width = Math.max(6, pending.dur * pps()) + 'px';
      }
    }

    function onUp(ev) {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      try { el.releasePointerCapture(ev.pointerId); } catch (err) {}
      el.style.transform = '';
      el.style.zIndex = '';
      document.querySelectorAll('.track-row.drag-over').forEach(function (r) { r.classList.remove('drag-over'); });
      if (!moved) { VE.renderTimeline(); return; }

      /* 套用到資料模型 */
      var target = pending.track || track;
      if (VE.overlaps(target, pending.start, pending.dur, clip.id)) {
        VE.toast('位置與其他片段重疊，已還原');
        VE.renderTimeline();
        return;
      }
      clip.start = pending.start;
      clip.duration = pending.dur;
      clip.in = pending.in;
      /* 左邊裁切會位移內容 → 關鍵影格時間同步位移 */
      if (mode === 'trim-l' && pending.trimDelta) {
        Object.keys(clip.keyframes || {}).forEach(function (prop) {
          clip.keyframes[prop] = clip.keyframes[prop]
            .map(function (k) { return { t: k.t - pending.trimDelta, v: k.v }; })
            .filter(function (k) { return k.t >= -0.001; });
          if (!clip.keyframes[prop].length) delete clip.keyframes[prop];
        });
      }
      if (target !== track) {
        track.clips = track.clips.filter(function (c) { return c !== clip; });
        target.clips.push(clip);
      }
      VE.commit();
      VE.refreshAll();
    }

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  function compatibleTrack(clip, track) {
    if (clip.type === 'audio') return track.type === 'audio';
    if (clip.type === 'video' || clip.type === 'image') return track.type === 'video';
    /* 文字/貼圖：疊加軌或影片軌皆可放 */
    return track.type === 'overlay' || track.type === 'video';
  }

  /* ── 軌道標頭拖曳：調整圖層順序（陣列順序＝顯示順序，越上面畫面圖層越高） ── */
  function startHeadDrag(e, tr) {
    e.preventDefault();
    var moved = false;
    var tracks = VE.state.project.tracks;

    function markDragging() {
      var idx = tracks.indexOf(tr);
      var heads = els.heads.querySelectorAll('.tl-head');
      if (heads[idx]) heads[idx].classList.add('dragging');
    }
    markDragging();

    function onMove(ev) {
      var cur = tracks.indexOf(tr);
      var heads = Array.prototype.slice.call(els.heads.querySelectorAll('.tl-head'));
      for (var i = 0; i < heads.length; i++) {
        if (i === cur) continue;
        var r = heads[i].getBoundingClientRect();
        var mid = r.top + r.height / 2;
        /* 越過目標列的中線才交換，避免高度不同時來回抖動 */
        if ((i < cur && ev.clientY < mid && ev.clientY > r.top) ||
            (i > cur && ev.clientY > mid && ev.clientY < r.bottom)) {
          moved = true;
          tracks.splice(cur, 1);
          tracks.splice(i, 0, tr);
          VE.renderTimeline();
          VE.drawFrame();
          markDragging();
          break;
        }
      }
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.querySelectorAll('.tl-head.dragging').forEach(function (x) { x.classList.remove('dragging'); });
      if (moved) {
        VE.commit();
        VE.refreshAll();
        VE.toast('已調整圖層順序');
      }
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function mediaCompatible(m, track) {
    return (m.type === 'audio' && track.type === 'audio') ||
           ((m.type === 'video' || m.type === 'image') && track.type === 'video');
  }

  /* ── 拖放落點幽靈預覽 ── */
  function showGhost(row, t, dur, ok, willNewTrack) {
    var g = document.getElementById('dropGhost');
    if (!g) {
      g = document.createElement('div');
      g.id = 'dropGhost';
    }
    if (g.parentNode !== row) row.appendChild(g);
    g.style.left = (t * pps()) + 'px';
    g.style.width = Math.max(8, dur * pps()) + 'px';
    g.classList.toggle('bad', !ok);
    g.classList.toggle('newtrack', !!willNewTrack);
  }

  function hideGhost() {
    var g = document.getElementById('dropGhost');
    if (g) g.remove();
  }

  /* ── 尺規（sticky，只畫可視範圍） ── */
  function drawRuler() {
    if (!els.ruler) return;
    var w = els.body.clientWidth || 600;
    if (els.ruler.width !== w) els.ruler.width = w;
    els.ruler.height = RULER_H;
    var c = els.ruler.getContext('2d');
    var scroll = els.body.scrollLeft;
    c.clearRect(0, 0, w, RULER_H);
    c.fillStyle = '#161a22';
    c.fillRect(0, 0, w, RULER_H);
    c.strokeStyle = '#2a3143';
    c.fillStyle = '#8b94a7';
    c.font = '10px Consolas,monospace';
    c.textBaseline = 'top';

    var steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    var step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] * pps() >= 70) { step = steps[i]; break; }
    }
    var t0 = Math.floor(scroll / pps() / step) * step;
    var t1 = (scroll + w) / pps();
    c.beginPath();
    for (var t = t0; t <= t1; t += step) {
      var x = t * pps() - scroll;
      c.moveTo(x + 0.5, 14);
      c.lineTo(x + 0.5, RULER_H);
      var mm = Math.floor(t / 60), ss = Math.round((t % 60) * 10) / 10;
      var lbl = (mm ? mm + ':' : '') + (ss < 10 && mm ? '0' : '') + ss + (mm ? '' : 's');
      c.fillText(lbl, x + 3, 3);
      /* 小刻度 */
      for (var k = 1; k < 5; k++) {
        var xs = (t + step * k / 5) * pps() - scroll;
        c.moveTo(xs + 0.5, 21);
        c.lineTo(xs + 0.5, RULER_H);
      }
    }
    c.stroke();
  }
  VE.drawRuler = drawRuler;

  VE.updatePlayheadUI = function () {
    if (!els.playhead) return;
    var x = VE.state.playhead * pps();
    els.playhead.style.left = x + 'px';
    /* 播放時自動捲動跟隨 */
    if (VE.state.playing) {
      var vis = els.body.clientWidth;
      if (x - els.body.scrollLeft > vis - 80) els.body.scrollLeft = x - vis + 80;
      else if (x < els.body.scrollLeft) els.body.scrollLeft = Math.max(0, x - 40);
    }
  };

  /* ── 分割 / 刪除 ── */
  VE.splitAtPlayhead = function () {
    var sel = VE.selectedClip();
    if (!sel) { VE.toast('請先選取要分割的片段'); return; }
    var clip = sel.clip, track = sel.track;
    var t = VE.state.playhead;
    if (t <= clip.start + 0.05 || t >= clip.start + clip.duration - 0.05) {
      VE.toast('播放頭不在片段範圍內'); return;
    }
    var cutRel = t - clip.start;
    var right = JSON.parse(JSON.stringify(clip));
    right.id = VE.uid();
    right.start = t;
    right.duration = clip.start + clip.duration - t;
    right.in = VE.sourceTime(clip, t);
    right.transition = { type: 'none', dur: 0.5 };
    /* 有變速曲線時，分割後兩段改為等速（避免曲線映射錯位） */
    if (clip.curve !== 'constant') {
      clip.curve = 'constant';
      right.curve = 'constant';
      VE.toast('分割後變速曲線已重設為等速');
    }
    clip.duration = cutRel;
    /* 關鍵影格分家：邊界處烘焙一個關鍵影格保持動畫連續 */
    Object.keys(clip.keyframes || {}).forEach(function (prop) {
      var all = clip.keyframes[prop];
      var boundaryV = VE.kfValue(clip, prop, cutRel);
      var leftK = all.filter(function (k) { return k.t <= cutRel; });
      var rightK = all.filter(function (k) { return k.t > cutRel; })
        .map(function (k) { return { t: k.t - cutRel, v: k.v }; });
      if (leftK.length) {
        leftK.push({ t: cutRel, v: boundaryV });
        clip.keyframes[prop] = leftK;
      } else delete clip.keyframes[prop];
      if (rightK.length) {
        rightK.unshift({ t: 0, v: boundaryV });
        right.keyframes[prop] = rightK;
      } else delete right.keyframes[prop];
    });
    track.clips.push(right);
    VE.state.selection = right.id;
    VE.commit();
    VE.refreshAll();
  };

  VE.deleteSelection = function () {
    var sel = VE.selectedClip();
    if (!sel) { VE.toast('請先選取片段'); return; }
    sel.track.clips = sel.track.clips.filter(function (c) { return c !== sel.clip; });
    VE.disposeClipEl(sel.clip.id);
    VE.state.selection = null;
    VE.commit();
    VE.refreshAll();
  };
})(window.VE);
