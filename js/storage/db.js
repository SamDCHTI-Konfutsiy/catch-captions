/* Subtitle Studio Pro — storage/db.js
   IndexedDB: projects, recents (file handles when supported), crash-recovery autosave.
   LocalStorage: settings. */
"use strict";
SSP.db = (() => {
  const NAME = "subtitle-studio-pro", VER = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const req = indexedDB.open(NAME, VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("projects"))
          db.createObjectStore("projects", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
        if (!db.objectStoreNames.contains("recents"))
          db.createObjectStore("recents", { keyPath: "key" });
        if (!db.objectStoreNames.contains("kv"))
          db.createObjectStore("kv", { keyPath: "k" });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      try { out = fn(s); } catch (e) { rej(e); return; }
      t.oncomplete = () => {
        if (out && "result" in out) res(out.result); else res(out);
      };
      t.onerror = () => rej(t.error);
    }));
  }

  const reqAll = s => s.getAll();

  return {
    /* ---- Projects ---- */
    saveProject: p => tx("projects", "readwrite", s => s.put(p)),
    getProject: id => tx("projects", "readonly", s => s.get(id)),
    deleteProject: id => tx("projects", "readwrite", s => s.delete(id)),
    listProjects: () => tx("projects", "readonly", reqAll)
      .then(list => (list || []).sort((a, b) => b.updatedAt - a.updatedAt)),

    /* ---- Recents (videos & subtitle files) ---- */
    addRecent(entry) {                       // {key, kind:'video'|'subtitle'|'url', name, handle?, url?, at}
      entry.at = Date.now();
      return tx("recents", "readwrite", s => s.put(entry));
    },
    listRecents: () => tx("recents", "readonly", reqAll)
      .then(list => (list || []).sort((a, b) => b.at - a.at).slice(0, 20)),
    removeRecent: key => tx("recents", "readwrite", s => s.delete(key)),

    /* ---- Key/value (crash recovery marker etc.) ---- */
    kvSet: (k, v) => tx("kv", "readwrite", s => s.put({ k, v })),
    kvGet: k => tx("kv", "readonly", s => s.get(k)).then(r => r ? r.v : undefined),
    kvDel: k => tx("kv", "readwrite", s => s.delete(k)),

    /* ---- Settings (LocalStorage: sync, tiny) ---- */
    settingsLoad() {
      try { return JSON.parse(localStorage.getItem("ssp-settings")) || {}; }
      catch (_) { return {}; }
    },
    settingsSave(obj) {
      try { localStorage.setItem("ssp-settings", JSON.stringify(obj)); } catch (_) {}
    }
  };
})();
