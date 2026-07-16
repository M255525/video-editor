/* db.js — IndexedDB 包裝：儲存匯入素材的二進位 Blob（重新整理後可還原） */
(function (VE) {
  'use strict';

  var DB_NAME = 'video-editor-db', STORE = 'blobs', dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          req.result.createObjectStore(STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
    return dbp;
  }

  VE.DB = {
    put: function (id, blob) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(blob, id);
          tx.oncomplete = resolve;
          tx.onerror = function () { reject(tx.error); };
        });
      }).catch(function (e) {
        console.warn('IndexedDB put failed（素材僅本次工作階段有效）', e);
      });
    },
    get: function (id) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { reject(req.error); };
        });
      }).catch(function () { return null; });
    },
    del: function (id) {
      return open().then(function (db) {
        return new Promise(function (resolve) {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(id);
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
      }).catch(function () {});
    },
    clear: function () {
      return open().then(function (db) {
        return new Promise(function (resolve) {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
      }).catch(function () {});
    }
  };
})(window.VE);
