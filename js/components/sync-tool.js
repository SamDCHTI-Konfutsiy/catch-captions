/* Subtitle Studio Pro — components/sync-tool.js
   Fixes timing drift between subtitles and audio/video:
   - Shift: add/subtract a fixed offset from every cue (constant drift).
   - Stretch: pick two reference points (a cue's original time + where it
     should actually be, heard from the video) and linearly rescale every
     cue's timing to match — fixes progressive drift that grows over the file.
   - Range: either tool can be limited to a portion of the file (from one
     selected cue to another) instead of the whole track, for when only a
     section drifted while the rest is already correct. */
"use strict";
SSP.syncTool = (() => {
  const $ = SSP.dom.$;
  let p1 = null, p2 = null;       // { old: number } transform anchors
  let rStart = null, rEnd = null; // { old: number } range boundaries (inclusive, by start time)

  function fmt(t) { return SSP.time.fmt(t); }

  function refreshPointUI(p, infoId, newInputId) {
    const t = SSP.i18n.t;
    if (p) {
      $(infoId).textContent = t("sync_point_captured").replace("{old}", fmt(p.old));
      $(newInputId).disabled = false;
    } else {
      $(infoId).textContent = t("sync_point_empty");
      $(newInputId).disabled = true;
    }
  }

  function refreshRangeUI() {
    const t = SSP.i18n.t;
    const on = $("#syncRangeOn").checked;
    $("#syncRangeFields").classList.toggle("hidden", !on);
    $("#syncRStartInfo").textContent = rStart ? t("sync_point_captured").replace("{old}", fmt(rStart.old)) : t("sync_point_empty");
    $("#syncREndInfo").textContent = rEnd ? t("sync_point_captured").replace("{old}", fmt(rEnd.old)) : t("sync_point_empty");
  }

  function capturePoint(n) {
    const s = SSP.model.selected;
    if (!s) { SSP.toast(SSP.i18n.t("sync_need_selection"), "err", 3000); return; }
    const p = { old: s.start };
    if (n === 1) { p1 = p; $("#syncP1New").value = SSP.player.time.toFixed(3); }
    else { p2 = p; $("#syncP2New").value = SSP.player.time.toFixed(3); }
    refreshUI();
  }

  function captureRange(edge) {
    const s = SSP.model.selected;
    if (!s) { SSP.toast(SSP.i18n.t("sync_need_selection"), "err", 3000); return; }
    if (edge === "start") rStart = { old: s.start }; else rEnd = { old: s.start };
    refreshRangeUI();
  }

  function refreshUI() {
    refreshPointUI(p1, "#syncP1Info", "#syncP1New");
    refreshPointUI(p2, "#syncP2Info", "#syncP2New");
    $("#btnSyncStretchApply").disabled = !(p1 && p2);
    refreshRangeUI();
  }

  /** Cues the transform should touch: either every cue, or only those whose
      start falls within the captured range (inclusive on both ends). */
  function targetSubs() {
    const all = SSP.model.all();
    if (!$("#syncRangeOn").checked) return all;
    if (!rStart || !rEnd) { SSP.toast(SSP.i18n.t("sync_range_incomplete"), "err", 3500); return null; }
    const lo = Math.min(rStart.old, rEnd.old), hi = Math.max(rStart.old, rEnd.old);
    return all.filter(s => s.start >= lo && s.start <= hi + 1e-6);
  }

  function applyShift() {
    const delta = parseFloat($("#syncShiftSec").value);
    if (!isFinite(delta) || delta === 0) { SSP.toast(SSP.i18n.t("sync_bad_number"), "err", 3000); return; }
    const subs = targetSubs();
    if (!subs || !subs.length) return;
    SSP.model.batch(() => {
      for (const s of subs) {
        const dur = s.end - s.start;
        const newStart = Math.max(0, s.start + delta);
        SSP.model.update(s.id, { start: newStart, end: newStart + dur }, { silent: true });
      }
    });
    SSP.toast(SSP.i18n.t("sync_shift_done").replace("{n}", subs.length).replace("{d}", delta.toFixed(3)), "ok", 3000);
  }

  function applyStretch() {
    if (!p1 || !p2) return;
    const p1new = parseFloat($("#syncP1New").value);
    const p2new = parseFloat($("#syncP2New").value);
    if (!isFinite(p1new) || !isFinite(p2new)) { SSP.toast(SSP.i18n.t("sync_bad_number"), "err", 3000); return; }
    if (p2.old === p1.old) { SSP.toast(SSP.i18n.t("sync_same_point"), "err", 4000); return; }
    const scale = (p2new - p1new) / (p2.old - p1.old);
    if (!isFinite(scale) || scale <= 0) { SSP.toast(SSP.i18n.t("sync_bad_scale"), "err", 4000); return; }
    const offset = p1new - scale * p1.old;
    const transform = t => scale * t + offset;

    const subs = targetSubs();
    if (!subs || !subs.length) return;
    SSP.model.batch(() => {
      for (const s of subs) {
        const newStart = Math.max(0, transform(s.start));
        const newEnd = Math.max(newStart + 0.05, transform(s.end));
        SSP.model.update(s.id, { start: newStart, end: newEnd }, { silent: true });
      }
    });
    SSP.toast(
      SSP.i18n.t("sync_stretch_done").replace("{n}", subs.length).replace("{s}", scale.toFixed(4)),
      "ok", 4000
    );
    p1 = null; p2 = null;
    refreshUI();
  }

  const open = () => {
    $("#syncShiftSec").value = "";
    p1 = null; p2 = null; rStart = null; rEnd = null;
    $("#syncRangeOn").checked = false;
    refreshUI();
    $("#syncModal").classList.remove("hidden");
  };
  const close = () => $("#syncModal").classList.add("hidden");

  function init() {
    $("#btnSync").addEventListener("click", open);
    $("#syncClose").addEventListener("click", close);
    $("#syncModal").addEventListener("click", e => { if (e.target.id === "syncModal") close(); });
    $("#syncShiftSec").addEventListener("keydown", e => e.stopPropagation());
    $("#syncP1New").addEventListener("keydown", e => e.stopPropagation());
    $("#syncP2New").addEventListener("keydown", e => e.stopPropagation());
    $("#btnSyncShiftApply").addEventListener("click", applyShift);
    $("#btnSyncP1Capture").addEventListener("click", () => capturePoint(1));
    $("#btnSyncP2Capture").addEventListener("click", () => capturePoint(2));
    $("#btnSyncStretchApply").addEventListener("click", applyStretch);
    $("#syncRangeOn").addEventListener("change", refreshRangeUI);
    $("#btnSyncRangeStart").addEventListener("click", () => captureRange("start"));
    $("#btnSyncRangeEnd").addEventListener("click", () => captureRange("end"));
  }

  return { init };
})();

