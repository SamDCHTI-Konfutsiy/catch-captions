/* Subtitle Studio Pro — export/export.js
   Subtitle export (SRT/VTT/ASS/SSA/SBV/TXT/JSON/CSV), project backup & restore. */
"use strict";
SSP.exporter = (() => {
  const $ = SSP.dom.$;

  const MIME = {
    srt: "application/x-subrip", vtt: "text/vtt", ass: "text/plain", ssa: "text/plain",
    sbv: "text/plain", txt: "text/plain", json: "application/json", csv: "text/csv"
  };

  function exportSubs(fmt) {
    const subs = SSP.model.all();
    const style = SSP.settings.get().style;
    const data = SSP.parsers.serialize(fmt, subs, {
      font: style.font, size: style.size * 2
    });
    const base = SSP.basename(SSP.player.sourceName || SSP.project.name() || "subtitles");
    SSP.download(`${base}.${fmt}`, data, MIME[fmt] + ";charset=utf-8");
    SSP.toast(SSP.i18n.t("exported") + ": " + fmt.toUpperCase(), "ok");
  }

  function exportBackup() {
    const payload = {
      app: "subtitle-studio-pro", version: 1, exportedAt: new Date().toISOString(),
      project: SSP.project.snapshot(),
      settings: SSP.settings.get()
    };
    SSP.download(
      `${(SSP.project.name() || "project").replace(/[^\w.-]+/g, "_")}.sspbackup.json`,
      JSON.stringify(payload, null, 2), "application/json"
    );
    SSP.toast(SSP.i18n.t("exported"), "ok");
  }

  async function restoreBackup() {
    const file = await SSP.pickFile(".json,.sspbackup");
    if (!file) return;
    try {
      const data = JSON.parse(await SSP.readText(file));
      const proj = data.project || data;   // accept bare project too
      if (!proj || !Array.isArray(proj.subtitles)) throw new Error("Not a Subtitle Studio Pro backup");
      await SSP.project.importSnapshot(proj);
      if (data.settings) SSP.settings.merge(data.settings);
      SSP.toast(SSP.i18n.t("backup_restored"), "ok");
    } catch (e) {
      SSP.toast("Restore: " + e.message, "err", 4000);
    }
  }

  function open() { $("#exportModal").classList.remove("hidden"); }
  function close() { $("#exportModal").classList.add("hidden"); }

  function init() {
    $("#btnExport").addEventListener("click", open);
    $("#exportClose").addEventListener("click", close);
    $("#exportModal").addEventListener("click", e => { if (e.target.id === "exportModal") close(); });
    SSP.dom.$$("#exportModal [data-fmt]").forEach(b =>
      b.addEventListener("click", () => exportSubs(b.dataset.fmt)));
    $("#btnBackup").addEventListener("click", exportBackup);
    $("#btnRestore").addEventListener("click", restoreBackup);
  }

  return { init, exportSubs, exportBackup, restoreBackup };
})();
