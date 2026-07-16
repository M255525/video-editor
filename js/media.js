/* media.js — 素材匯入、縮圖、素材庫、片段媒體元素管理 */
(function (VE) {
  'use strict';

  /* clipId -> { el:HTMLVideoElement|HTMLAudioElement, srcNode, gain, connected } */
  VE.clipEls = {};
  /* mediaId -> HTMLImageElement */
  VE.imgCache = {};

  function typeOf(file) {
    if (file.type.indexOf('video/') === 0) return 'video';
    if (file.type.indexOf('audio/') === 0) return 'audio';
    if (file.type.indexOf('image/') === 0) return 'image';
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['mp4', 'm4v', 'webm', 'mov', 'mkv'].indexOf(ext) >= 0) return 'video';
    if (['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'weba'].indexOf(ext) >= 0) return 'audio';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].indexOf(ext) >= 0) return 'image';
    return null;
  }

  function probeVideo(url) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.src = url;
      v.onerror = function () { reject(new Error('無法讀取影片')); };
      v.onloadedmetadata = function () {
        var meta = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
        var t = Math.min(0.3, (v.duration || 1) / 2);
        v.onseeked = function () {
          try {
            var c = document.createElement('canvas');
            c.width = 160; c.height = Math.max(2, Math.round(160 * meta.height / Math.max(1, meta.width)));
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            meta.thumb = c.toDataURL('image/jpeg', 0.6);
          } catch (e) { meta.thumb = null; }
          resolve(meta);
        };
        v.currentTime = t;
        setTimeout(function () { if (!meta.thumb) resolve(meta); }, 3000);
      };
    });
  }

  function probeImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = 160; c.height = Math.max(2, Math.round(160 * img.naturalHeight / Math.max(1, img.naturalWidth)));
        try { c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); } catch (e) {}
        resolve({ duration: 0, width: img.naturalWidth, height: img.naturalHeight, thumb: c.toDataURL('image/jpeg', 0.7) });
      };
      img.onerror = function () { reject(new Error('無法讀取圖片')); };
      img.src = url;
    });
  }

  function probeAudio(url) {
    return new Promise(function (resolve, reject) {
      var a = document.createElement('audio');
      a.preload = 'metadata';
      a.src = url;
      a.onloadedmetadata = function () { resolve({ duration: a.duration, width: 0, height: 0, thumb: null }); };
      a.onerror = function () { reject(new Error('無法讀取音訊')); };
    });
  }

  /* ── SRT / VTT 字幕匯入 ── */
  function parseSRT(txt) {
    txt = txt.replace(/^﻿/, '').replace(/\r/g, '');
    var re = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
    var cues = [];
    txt.split(/\n\n+/).forEach(function (block) {
      var lines = block.split('\n').filter(function (l) { return l.trim() !== ''; });
      for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(re);
        if (!m) continue;
        var s = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
        var e = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
        var text = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
        if (text && e > s) cues.push({ start: s, end: e, text: text });
        break;
      }
    });
    return cues;
  }

  /** 匯入字幕檔：解析後依時間生成文字片段，放在專用「字幕」疊加軌 */
  VE.importSRT = function (file) {
    return file.text().then(function (txt) {
      var cues = parseSRT(txt);
      if (!cues.length) { VE.toast('無法解析字幕檔：' + file.name); return; }
      var p = VE.state.project;
      var track = null;
      p.tracks.forEach(function (tr) { if (tr.type === 'overlay' && tr.name === '字幕') track = tr; });
      if (!track) {
        track = VE.newTrack('overlay', '字幕');
        p.tracks.unshift(track);
      }
      cues.forEach(function (cue) {
        var clip = VE.newClip({
          type: 'text', start: cue.start,
          duration: Math.max(0.2, cue.end - cue.start),
          content: cue.text, size: 44
        });
        clip.transform.y = p.height * 0.38;   // 靠下方的字幕位置
        track.clips.push(clip);
      });
      VE.commit();
      VE.refreshAll();
      VE.toast('已匯入 ' + cues.length + ' 句字幕（' + file.name + '）');
    }).catch(function (e) {
      VE.toast('讀取字幕檔失敗：' + e.message);
    });
  };

  /** 匯入 File 陣列（input / 拖放 / 測試皆走此入口） */
  VE.importFiles = function (files) {
    var list = Array.prototype.slice.call(files || []);
    /* 字幕檔走專屬流程 */
    list.filter(function (f) { return /\.(srt|vtt)$/i.test(f.name); })
        .forEach(function (f) { VE.importSRT(f); });
    list = list.filter(function (f) { return !/\.(srt|vtt)$/i.test(f.name); });
    var jobs = list.map(function (file) {
      var type = typeOf(file);
      if (!type) { VE.toast('不支援的檔案：' + file.name); return Promise.resolve(); }
      var url = URL.createObjectURL(file);
      var probe = type === 'video' ? probeVideo(url) : type === 'image' ? probeImage(url) : probeAudio(url);
      return probe.then(function (meta) {
        /* 若有同名的離線素材（上次工作階段留下的參照）→ 直接復活它，clip 參照不變 */
        var existing = null;
        Object.keys(VE.state.media).forEach(function (id) {
          var m = VE.state.media[id];
          if (m.offline && m.name === file.name) existing = m;
        });
        var m = existing || {
          id: VE.uid(), name: file.name, type: type, mime: file.type
        };
        m.duration = meta.duration; m.width = meta.width; m.height = meta.height;
        if (meta.thumb) m.thumb = meta.thumb;
        m.url = url; m.offline = false;
        VE.state.media[m.id] = m;
        delete VE.imgCache[m.id];
        /* 復活後把引用此素材的片段元素重建 */
        Object.keys(VE.clipEls).forEach(function (cid) {
          var found = VE.getClip(cid);
          if (!found || found.clip.mediaId === m.id) VE.disposeClipEl(cid);
        });
        VE.DB.put(m.id, file);
        return m;
      }).catch(function (e) {
        URL.revokeObjectURL(url);
        VE.toast(file.name + '：' + e.message);
      });
    });
    return Promise.all(jobs).then(function (ms) {
      VE.renderMediaGrid();
      VE.saveLS();
      var ok = ms.filter(Boolean);
      if (ok.length) VE.toast('已匯入 ' + ok.length + ' 個素材');
      return ok;
    });
  };

  /** 從 IndexedDB 還原素材（頁面載入時） */
  VE.restoreMediaFromDB = function (mediaMeta) {
    var ids = Object.keys(mediaMeta || {});
    return Promise.all(ids.map(function (id) {
      var meta = mediaMeta[id];
      VE.state.media[id] = meta;
      return VE.DB.get(id).then(function (blob) {
        if (blob) {
          meta.url = URL.createObjectURL(blob);
          meta.offline = false;
        } else {
          meta.url = null;
          meta.offline = true;
        }
      });
    })).then(function () {
      var missing = ids.filter(function (id) { return VE.state.media[id].offline; });
      if (missing.length) VE.toast('有 ' + missing.length + ' 個素材離線，請重新匯入同名檔案還原');
    });
  };

  VE.deleteMedia = function (mediaId) {
    var m = VE.state.media[mediaId];
    if (!m) return;
    /* 一併移除引用此素材的片段 */
    VE.state.project.tracks.forEach(function (tr) {
      tr.clips.filter(function (c) { return c.mediaId === mediaId; }).forEach(function (c) {
        VE.disposeClipEl(c.id);
        if (VE.state.selection === c.id) VE.state.selection = null;
      });
      tr.clips = tr.clips.filter(function (c) { return c.mediaId !== mediaId; });
    });
    if (m.url) URL.revokeObjectURL(m.url);
    delete VE.state.media[mediaId];
    delete VE.imgCache[mediaId];
    VE.DB.del(mediaId);
    VE.commit();
    VE.refreshAll();
  };

  /* ── 素材庫 UI ── */
  var ICONS = { video: '🎞️', audio: '🎵', image: '🖼️' };

  VE.renderMediaGrid = function () {
    var grid = document.getElementById('mediaGrid');
    if (!grid) return;
    grid.innerHTML = '';
    Object.keys(VE.state.media).forEach(function (id) {
      var m = VE.state.media[id];
      var item = document.createElement('div');
      item.className = 'media-item' + (m.offline ? ' offline' : '');
      item.draggable = !m.offline;
      item.title = m.name + (m.offline ? '（離線，請重新匯入同名檔案）' : '');

      if (m.thumb) {
        var img = document.createElement('img');
        img.className = 'media-thumb'; img.src = m.thumb; img.draggable = false;
        item.appendChild(img);
      } else {
        var ic = document.createElement('div');
        ic.className = 'media-thumb-icon'; ic.textContent = ICONS[m.type] || '📄';
        item.appendChild(ic);
      }
      if (m.duration) {
        var d = document.createElement('span');
        d.className = 'media-dur'; d.textContent = VE.fmtTime(m.duration);
        item.appendChild(d);
      }
      var name = document.createElement('div');
      name.className = 'media-name'; name.textContent = m.name;
      item.appendChild(name);

      var add = document.createElement('button');
      add.className = 'media-add'; add.textContent = '＋'; add.title = '加到時間軸';
      add.onclick = function (e) { e.stopPropagation(); VE.addMediaToTimeline(id); };
      item.appendChild(add);

      var del = document.createElement('button');
      del.className = 'media-del'; del.textContent = '×'; del.title = '刪除素材（含時間軸片段）';
      del.onclick = function (e) { e.stopPropagation(); VE.deleteMedia(id); };
      item.appendChild(del);

      item.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', 'media:' + id);
        e.dataTransfer.effectAllowed = 'copy';
        VE.dragMedia = m;                       // 給時間軸畫落點幽靈預覽用
        document.body.dataset.dragType = m.type; // CSS 亮起相容軌道
      });
      item.addEventListener('dragend', function () {
        VE.dragMedia = null;
        delete document.body.dataset.dragType;
        var g = document.getElementById('dropGhost');
        if (g) g.remove();
      });
      item.addEventListener('dblclick', function () { if (!m.offline) VE.addMediaToTimeline(id); });
      grid.appendChild(item);
    });
  };

  /** 把素材加到適合的軌道（優先放在播放頭；若重疊則接在軌道最後） */
  VE.addMediaToTimeline = function (mediaId, atTime, trackId) {
    var m = VE.state.media[mediaId];
    if (!m || m.offline) { VE.toast('素材離線，請先重新匯入'); return; }
    var p = VE.state.project;
    var track = null;
    if (trackId) {
      p.tracks.forEach(function (tr) { if (tr.id === trackId) track = tr; });
    }
    if (!track) {
      if (m.type === 'audio') track = p.tracks.filter(function (t) { return t.type === 'audio'; })[0];
      else track = p.tracks.filter(function (t) { return t.type === 'video' && t.main; })[0] ||
                   p.tracks.filter(function (t) { return t.type === 'video'; })[0];
    }
    if (!track) return;
    var dur = m.type === 'image' ? 4 : m.duration;
    var start = (atTime != null) ? atTime : VE.state.playhead;
    /* 位置重疊時：先找同型別的其他空軌道，都沒有就自動新增一軌（比照剪映） */
    if (overlaps(track, start, dur, null)) {
      var alt = null;
      p.tracks.forEach(function (tr2) {
        if (!alt && tr2.type === track.type && tr2 !== track && !overlaps(tr2, start, dur, null)) alt = tr2;
      });
      if (alt) {
        track = alt;
      } else {
        var names = { audio: '音訊', video: '畫中畫', overlay: '文字 / 貼圖' };
        var count = p.tracks.filter(function (t) { return t.type === track.type; }).length;
        var nt = VE.newTrack(track.type, names[track.type] + ' ' + (count + 1));
        if (track.type === 'audio') p.tracks.push(nt);                 // 音訊軌往下疊
        else p.tracks.splice(p.tracks.indexOf(track), 0, nt);          // 影片/疊加軌往上疊
        track = nt;
        VE.toast('位置重疊，已自動新增「' + nt.name + '」軌道');
      }
    }
    var clip = VE.newClip({ type: m.type, mediaId: mediaId, start: start, duration: dur });
    track.clips.push(clip);
    VE.state.selection = clip.id;
    VE.commit();
    VE.refreshAll();
    return clip;
  };

  function trackEnd(track) {
    var e = 0;
    track.clips.forEach(function (c) { e = Math.max(e, c.start + c.duration); });
    return e;
  }
  VE.trackEnd = trackEnd;

  function overlaps(track, start, dur, excludeId) {
    var e = start + dur - 0.001;
    for (var i = 0; i < track.clips.length; i++) {
      var c = track.clips[i];
      if (excludeId && c.id === excludeId) continue;
      if (start < c.start + c.duration - 0.001 && e > c.start) return true;
    }
    return false;
  }
  VE.overlaps = overlaps;

  /* ── 片段媒體元素（隱藏的 <video>/<audio>） ── */

  VE.ensureClipEl = function (clip) {
    var entry = VE.clipEls[clip.id];
    if (entry) return entry;
    var m = VE.state.media[clip.mediaId];
    if (!m || !m.url) return null;
    var el = document.createElement(clip.type === 'audio' ? 'audio' : 'video');
    el.src = m.url;
    el.preload = 'auto';
    el.playsInline = true;
    el.crossOrigin = null;
    if ('preservesPitch' in el) el.preservesPitch = false;
    entry = { el: el, srcNode: null, gain: null, connected: false };
    VE.clipEls[clip.id] = entry;
    /* 音訊路由交給 preview.js（若 AudioContext 已建立則立即接上） */
    if (VE.connectClipAudio) VE.connectClipAudio(clip, entry);
    return entry;
  };

  VE.disposeClipEl = function (clipId) {
    var entry = VE.clipEls[clipId];
    if (!entry) return;
    try { entry.el.pause(); entry.el.removeAttribute('src'); entry.el.load(); } catch (e) {}
    try { if (entry.srcNode) entry.srcNode.disconnect(); if (entry.gain) entry.gain.disconnect(); } catch (e) {}
    delete VE.clipEls[clipId];
  };

  VE.getImage = function (mediaId) {
    var m = VE.state.media[mediaId];
    if (!m || !m.url) return null;
    var img = VE.imgCache[mediaId];
    if (!img) {
      img = new Image();
      img.src = m.url;
      img.onload = function () { if (VE.drawFrame) VE.drawFrame(); };
      VE.imgCache[mediaId] = img;
    }
    return img.complete && img.naturalWidth ? img : null;
  };

  /* ── 匯入 UI 掛載 ── */
  VE.initMediaUI = function () {
    var dz = document.getElementById('dropzone');
    var fi = document.getElementById('fileInput');
    dz.addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function () {
      VE.importFiles(fi.files);
      fi.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer.files.length) VE.importFiles(e.dataTransfer.files);
    });
    /* 整頁拖放也接受檔案 */
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length) VE.importFiles(e.dataTransfer.files);
      VE.clearDragState();
    });
    /* 保險：drop 後素材庫重繪可能吃掉來源元素的 dragend，全域再清一次 */
    document.addEventListener('dragend', function () { VE.clearDragState(); });
  };

  VE.clearDragState = function () {
    VE.dragMedia = null;
    delete document.body.dataset.dragType;
    var g = document.getElementById('dropGhost');
    if (g) g.remove();
  };
})(window.VE);
