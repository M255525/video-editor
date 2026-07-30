/* state.js — 專案資料模型、undo/redo、localStorage 存讀 */
(function (VE) {
  'use strict';

  VE.LS_KEY = 'video-editor-project-v1';
  VE.FPS = 30;

  /* 執行期狀態（不序列化的部分：selection/playhead/playing/縮放） */
  VE.state = {
    project: null,     // {name,width,height,fps,tracks:[]}
    media: {},         // id -> {id,name,type,mime,duration,width,height,thumb,url,offline}
    selection: null,   // clipId
    playhead: 0,
    playing: false,
    pxPerSec: 80,
    snap: true
  };

  VE.newTrack = function (type, name, main) {
    return { id: VE.uid(), type: type, name: name, main: !!main, muted: false, clips: [] };
  };

  VE.newProject = function () {
    return {
      name: '未命名專案',
      width: 1280, height: 720, fps: VE.FPS,
      /* 陣列順序 = 時間軸顯示順序（上→下）；渲染時反向（主軌最先畫、疊加層最後畫） */
      tracks: [
        VE.newTrack('overlay', '文字 / 貼圖'),
        VE.newTrack('video',   '畫中畫'),
        VE.newTrack('video',   '主影片軌', true),
        VE.newTrack('audio',   '音訊')
      ]
    };
  };

  /** 建立片段（type: video|image|audio|text|sticker） */
  VE.newClip = function (opts) {
    var c = {
      id: VE.uid(),
      type: opts.type,
      mediaId: opts.mediaId || null,
      start: opts.start || 0,
      duration: opts.duration || 3,
      in: opts.in || 0,           // 素材起始（秒，speed 套用前的原始素材時間）
      speed: 1, curve: 'constant',
      volume: 1, muted: false, fadeIn: 0, fadeOut: 0,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      keyframes: {},
      filter: { brightness: 0, contrast: 0, saturate: 0, hue: 0, blur: 0 },
      filterPreset: 'none',
      transition: { type: 'none', dur: 0.5 }
    };
    if (opts.type === 'text') {
      c.text = {
        content: opts.content || '請輸入文字',
        size: opts.size || 64,
        color: '#ffffff', strokeColor: '#000000', strokeWidth: 4,
        font: '"Microsoft JhengHei","Noto Sans TC",sans-serif',
        bold: true, bg: false, bgColor: '#000000'
      };
    }
    if (opts.type === 'sticker') {
      c.emoji = opts.emoji || '😀';
      c.transform.scale = 1;
    }
    return c;
  };

  VE.getClip = function (id) {
    var tracks = VE.state.project.tracks;
    for (var i = 0; i < tracks.length; i++) {
      var clips = tracks[i].clips;
      for (var j = 0; j < clips.length; j++) {
        if (clips[j].id === id) return { clip: clips[j], track: tracks[i] };
      }
    }
    return null;
  };

  VE.selectedClip = function () {
    return VE.state.selection ? VE.getClip(VE.state.selection) : null;
  };

  /** 時間軸上 t 時刻此軌道的作用中片段 */
  VE.clipAt = function (track, t) {
    for (var i = 0; i < track.clips.length; i++) {
      var c = track.clips[i];
      if (t >= c.start && t < c.start + c.duration) return c;
    }
    return null;
  };

  /** 同軌道中緊接在 clip 之前結束的片段（判斷轉場用） */
  VE.prevAdjacent = function (track, clip) {
    var best = null;
    for (var i = 0; i < track.clips.length; i++) {
      var c = track.clips[i];
      if (c === clip) continue;
      if (Math.abs((c.start + c.duration) - clip.start) < 0.05) {
        if (!best || c.start > best.start) best = c;
      }
    }
    return best;
  };

  VE.projectDuration = function () {
    var d = 0;
    VE.state.project.tracks.forEach(function (tr) {
      tr.clips.forEach(function (c) { d = Math.max(d, c.start + c.duration); });
    });
    return d;
  };

  /** 片段在時間軸 t 對應的素材來源時間（含變速與曲線） */
  VE.sourceTime = function (clip, t) {
    var p = VE.clamp((t - clip.start) / clip.duration, 0, 1);
    var q = (VE.CURVES[clip.curve] || VE.CURVES.constant).f(p);
    return clip.in + q * clip.duration * clip.speed;
  };

  /* ── 序列化 / undo ── */

  function snapshot() {
    var p = VE.state.project;
    return JSON.stringify({ name: p.name, width: p.width, height: p.height, fps: p.fps, tracks: p.tracks });
  }

  var history = [], hIdx = -1, HISTORY_MAX = 60;

  VE.historyInit = function () {
    history = [snapshot()];
    hIdx = 0;
    if (VE.updateHistoryUI) VE.updateHistoryUI();
  };

  VE.canUndo = function () { return hIdx > 0; };
  VE.canRedo = function () { return hIdx < history.length - 1; };

  /** 每次「已完成的變更」呼叫一次（拖曳結束、輸入 change 等） */
  VE.commit = function () {
    var snap = snapshot();
    if (history[hIdx] === snap) return;
    history = history.slice(0, hIdx + 1);
    history.push(snap);
    if (history.length > HISTORY_MAX) history.shift();
    hIdx = history.length - 1;
    if (VE.updateHistoryUI) VE.updateHistoryUI();
    VE.autosave();
  };

  function applySnapshot(snap) {
    var d = JSON.parse(snap);
    var p = VE.state.project;
    p.name = d.name; p.width = d.width; p.height = d.height; p.fps = d.fps;
    p.tracks = d.tracks;
    if (VE.state.selection && !VE.getClip(VE.state.selection)) VE.state.selection = null;
    VE.refreshAll();
    VE.autosave();
  }

  VE.undo = function () {
    if (hIdx <= 0) { VE.toast('沒有可復原的步驟'); return; }
    hIdx--; applySnapshot(history[hIdx]);
    if (VE.updateHistoryUI) VE.updateHistoryUI();
  };
  VE.redo = function () {
    if (hIdx >= history.length - 1) { VE.toast('沒有可重做的步驟'); return; }
    hIdx++; applySnapshot(history[hIdx]);
    if (VE.updateHistoryUI) VE.updateHistoryUI();
  };

  /* ── localStorage ──
     只存專案結構與素材中繼資料；素材二進位存 IndexedDB（db.js） */
  VE.saveLS = function () {
    try {
      var mediaMeta = {};
      Object.keys(VE.state.media).forEach(function (id) {
        var m = VE.state.media[id];
        mediaMeta[id] = { id: m.id, name: m.name, type: m.type, mime: m.mime, duration: m.duration, width: m.width, height: m.height, thumb: m.thumb };
      });
      localStorage.setItem(VE.LS_KEY, JSON.stringify({ project: JSON.parse(snapshot()), mediaMeta: mediaMeta, savedAt: Date.now() }));
      var st = document.getElementById('saveStatus');
      if (st) { st.textContent = '已自動儲存'; setTimeout(function () { st.textContent = ''; }, 2000); }
    } catch (e) {
      console.warn('saveLS failed', e);
    }
  };

  VE.autosave = VE.debounce(function () { VE.saveLS(); }, 800);

  /** 回傳 {project, mediaMeta} 或 null */
  VE.loadLS = function () {
    try {
      var raw = localStorage.getItem(VE.LS_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || !d.project || !Array.isArray(d.project.tracks)) return null;
      return d;
    } catch (e) {
      console.warn('loadLS failed', e);
      return null;
    }
  };

  /** 全域重繪（undo/redo/載入後） */
  VE.refreshAll = function () {
    if (VE.renderTimeline) VE.renderTimeline();
    if (VE.renderProps) VE.renderProps();
    if (VE.renderMediaGrid) VE.renderMediaGrid();
    if (VE.resizeCanvas) VE.resizeCanvas();
    if (VE.drawFrame) VE.drawFrame();
    if (VE.updateTimeLabels) VE.updateTimeLabels();
  };
})(window.VE);
