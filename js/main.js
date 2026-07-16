/* main.js — 啟動流程、頂部工具列、鍵盤快捷鍵 */
(function (VE) {
  'use strict';

  function init() {
    /* 載入或建立專案 */
    var saved = VE.loadLS();
    var mediaMeta = null;
    if (saved) {
      VE.state.project = VE.newProject();
      VE.state.project.name = saved.project.name;
      VE.state.project.width = saved.project.width;
      VE.state.project.height = saved.project.height;
      VE.state.project.fps = saved.project.fps || VE.FPS;
      VE.state.project.tracks = saved.project.tracks;
      mediaMeta = saved.mediaMeta;
    } else {
      VE.state.project = VE.newProject();
    }

    VE.initPreview();
    VE.initTimeline();
    VE.initPanels();
    VE.initMediaUI();
    VE.initExport();
    initTopbar();
    initKeyboard();
    initResizers();

    VE.historyInit();
    VE.refreshAll();

    if (mediaMeta && Object.keys(mediaMeta).length) {
      VE.restoreMediaFromDB(mediaMeta).then(function () {
        VE.refreshAll();
      });
    }
  }

  function initTopbar() {
    var nameInput = document.getElementById('projName');
    nameInput.value = VE.state.project.name;
    nameInput.addEventListener('change', function () {
      VE.state.project.name = nameInput.value || '未命名專案';
      VE.commit();
    });

    document.getElementById('btnUndo').addEventListener('click', function () { VE.undo(); });
    document.getElementById('btnRedo').addEventListener('click', function () { VE.redo(); });

    var aspect = document.getElementById('aspectSel');
    var cur = VE.state.project.width + 'x' + VE.state.project.height;
    for (var i = 0; i < aspect.options.length; i++) {
      if (aspect.options[i].value === cur) aspect.selectedIndex = i;
    }
    aspect.addEventListener('change', function () {
      var wh = aspect.value.split('x');
      VE.state.project.width = +wh[0];
      VE.state.project.height = +wh[1];
      VE.resizeCanvas();
      VE.commit();
      VE.drawFrame();
    });

    document.getElementById('btnNew').addEventListener('click', function () {
      if (!confirm('確定要開新專案嗎？時間軸與素材庫將全部清空。')) return;
      VE.pause();
      /* 清片段媒體元素 */
      Object.keys(VE.clipEls).forEach(function (id) { VE.disposeClipEl(id); });
      /* 清素材庫（含 objectURL 與 IndexedDB） */
      Object.keys(VE.state.media).forEach(function (id) {
        var m = VE.state.media[id];
        if (m.url) { try { URL.revokeObjectURL(m.url); } catch (e) {} }
      });
      VE.state.media = {};
      VE.imgCache = {};
      VE.DB.clear();
      VE.state.project = VE.newProject();
      VE.state.selection = null;
      VE.state.playhead = 0;
      VE.historyInit();
      VE.saveLS();
      VE.refreshAll();
      VE.toast('已建立新專案');
    });

    document.getElementById('btnPlay').addEventListener('click', function () { VE.togglePlay(); });
    document.getElementById('btnPrevFrame').addEventListener('click', function () { VE.stepFrame(-1); });
    document.getElementById('btnNextFrame').addEventListener('click', function () { VE.stepFrame(1); });
  }

  /* ── 復原/重做按鈕啟用狀態（頂部＋時間軸工具列共 4 顆） ── */
  VE.updateHistoryUI = function () {
    ['btnUndo', 'btnUndo2'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.disabled = !VE.canUndo();
    });
    ['btnRedo', 'btnRedo2'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.disabled = !VE.canRedo();
    });
  };

  /* ── 面板大小調整（左/右面板寬度、時間軸高度；記住上次配置） ── */
  var UI_KEY = 'video-editor-ui-v1';

  function initResizers() {
    var left = document.getElementById('left');
    var right = document.getElementById('right');
    var bottom = document.getElementById('bottom');

    /* 還原上次配置 */
    try {
      var ui = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      if (ui.leftW) left.style.width = ui.leftW + 'px';
      if (ui.rightW) right.style.width = ui.rightW + 'px';
      if (ui.bottomH) bottom.style.height = ui.bottomH + 'px';
    } catch (e) {}

    var saveUI = VE.debounce(function () {
      try {
        localStorage.setItem(UI_KEY, JSON.stringify({
          leftW: left.offsetWidth, rightW: right.offsetWidth, bottomH: bottom.offsetHeight
        }));
      } catch (e) {}
    }, 400);

    function makeResizer(id, apply) {
      var rz = document.getElementById(id);
      rz.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        rz.classList.add('active');
        try { rz.setPointerCapture(e.pointerId); } catch (err) {}
        var move = function (ev) {
          apply(ev);
          if (VE.drawRuler) VE.drawRuler();
          if (VE.drawFrame) VE.drawFrame();
        };
        var up = function (ev) {
          rz.classList.remove('active');
          try { rz.releasePointerCapture(ev.pointerId); } catch (err) {}
          rz.removeEventListener('pointermove', move);
          rz.removeEventListener('pointerup', up);
          if (VE.renderTimeline) VE.renderTimeline();   // 重算內容寬度
          saveUI();
        };
        rz.addEventListener('pointermove', move);
        rz.addEventListener('pointerup', up);
      });
    }

    makeResizer('rzLeft', function (ev) {
      var w = ev.clientX - left.getBoundingClientRect().left;
      left.style.width = Math.min(560, Math.max(180, w)) + 'px';
    });
    makeResizer('rzRight', function (ev) {
      var w = right.getBoundingClientRect().right - ev.clientX;
      right.style.width = Math.min(520, Math.max(200, w)) + 'px';
    });
    makeResizer('rzBottom', function (ev) {
      var h = window.innerHeight - ev.clientY - document.getElementById('footer').offsetHeight;
      bottom.style.height = Math.min(window.innerHeight * 0.7, Math.max(140, h)) + 'px';
    });
  }

  function initKeyboard() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (VE.exporting) return;

      if (e.code === 'Space') {
        e.preventDefault();
        VE.togglePlay();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (VE.state.selection) { e.preventDefault(); VE.deleteSelection(); }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) VE.redo(); else VE.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        VE.redo();
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey) {
        VE.splitAtPlayhead();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        VE.saveLS();
        VE.toast('已儲存');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        VE.stepFrame(e.shiftKey ? -10 : -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        VE.stepFrame(e.shiftKey ? 10 : 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        VE.pause(); VE.seek(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        VE.pause(); VE.seek(VE.projectDuration());
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.VE);
