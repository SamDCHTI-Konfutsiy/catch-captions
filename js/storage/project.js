/* Subtitle Studio Pro — storage/project.js
   Multiple projects in IndexedDB, timed autosave, crash recovery. */
"use strict";
SSP.project = (() => {
  const $ = SSP.dom.$, el = SSP.dom.el;
  let cur = null;                // {id, name, createdAt, updatedAt, subtitles, videoName}
  let autosaveTimer = 0;

  function fresh(name) {
    return {
      id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || "Untitled project",
      createdAt: Date.now(), updatedAt: Date.now(),
      subtitles: [], videoName: null
    };
  }

  function snapshot() {
    return {
      ...cur,
      updatedAt: Date.now(),
      subtitles: SSP.model.serializeState(),
      videoName: SSP.player.sourceName || cur.videoName
    };
  }

  async function saveNow(toastIt = true) {
    if (!cur) return;
    cur = snapshot();
    await SSP.db.saveProject(cur);
    await SSP.db.kvSet("lastProjectId", cur.id);
    SSP.model.markClean();
    if (toastIt) SSP.toast(SSP.i18n.t("saved"), "ok", 1200);
  }

  const autosave = async () => {
    if (!cur || !SSP.model.isDirty()) return;
    cur = snapshot();
    await SSP.db.saveProject(cur);
    await SSP.db.kvSet("lastProjectId", cur.id);
    SSP.model.markClean();
    SSP.bus.emit("status", SSP.i18n.t("autosaved") + " · " + new Date().toLocaleTimeString());
    setTimeout(() => SSP.bus.emit("status", ""), 2500);
  };

  function scheduleAutosave() {
    clearInterval(autosaveTimer);
    const sec = SSP.settings.get().autosaveSec || 30;
    autosaveTimer = setInterval(autosave, sec * 1000);
  }

  function openProject(p) {
    cur = p;
    $("#projectName").value = p.name;
    SSP.model.load(p.subtitles || []);
    SSP.db.kvSet("lastProjectId", p.id);
  }

  function newProject(name) {
    openProject(fresh(name));
    saveNow(false);
  }

  async function importSnapshot(proj) {
    const p = fresh(proj.name || "Restored project");
    p.subtitles = proj.subtitles || [];
    p.videoName = proj.videoName || null;
    await SSP.db.saveProject(p);
    openProject(p);
  }

  /* ---------------- Projects modal ---------------- */
  async function renderModal() {
    const t = SSP.i18n.t;
    const list = $("#projList");
    list.innerHTML = "";
    const items = await SSP.db.listProjects();
    for (const p of items) {
      list.append(el("div", { class: "item" }, [
        el("span", { class: "grow", text: p.name }),
        el("span", { class: "meta", text: `${(p.subtitles || []).length} · ${new Date(p.updatedAt).toLocaleString()}` }),
        el("button", {
          class: "btn outline", text: t("open_project"),
          onclick: async () => { await saveNow(false); openProject(p); closeModal(); }
        }),
        el("button", {
          class: "btn danger icon", "aria-label": t("delete_project"), html: "✕",
          onclick: async e => {
            e.stopPropagation();
            if (!confirm(t("confirm_delete_project"))) return;
            await SSP.db.deleteProject(p.id);
            if (cur && cur.id === p.id) newProject();
            renderModal();
          }
        })
      ]));
    }
  }
  const openModal = () => { renderModal(); $("#projModal").classList.remove("hidden"); };
  const closeModal = () => $("#projModal").classList.add("hidden");

  /* ---------------- Boot / crash recovery ---------------- */
  async function boot() {
    const lastId = await SSP.db.kvGet("lastProjectId").catch(() => null);
    const wasDirty = await SSP.db.kvGet("dirtyFlag").catch(() => null);
    if (lastId) {
      const p = await SSP.db.getProject(lastId).catch(() => null);
      if (p) {
        openProject(p);
        if (wasDirty) SSP.toast(SSP.i18n.t("recovered"), "ok", 4000);
        return;
      }
    }
    newProject();
  }

  function init() {
    $("#btnProjects").addEventListener("click", openModal);
    $("#projClose").addEventListener("click", closeModal);
    $("#projModal").addEventListener("click", e => { if (e.target.id === "projModal") closeModal(); });
    $("#btnNewProject").addEventListener("click", () => { saveNow(false).then(() => { newProject(); closeModal(); }); });
    $("#btnSave").addEventListener("click", () => saveNow());

    $("#projectName").addEventListener("change", () => {
      if (cur) { cur.name = $("#projectName").value.trim() || "Untitled project"; saveNow(false); }
    });
    $("#projectName").addEventListener("keydown", e => e.stopPropagation());

    // Crash-recovery flag: set while dirty, cleared on save + on clean unload
    SSP.bus.on("model:change", SSP.debounce(() => SSP.db.kvSet("dirtyFlag", 1), 500));
    window.addEventListener("beforeunload", () => { autosave(); SSP.db.kvDel("dirtyFlag"); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) autosave(); });

    SSP.bus.on("settings:change", scheduleAutosave);
    scheduleAutosave();
  }

  return {
    init, boot, saveNow, newProject, openProject, importSnapshot, snapshot,
    name: () => cur ? cur.name : "", get current() { return cur; }
  };
})();
