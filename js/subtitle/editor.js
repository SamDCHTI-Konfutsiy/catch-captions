/* Subtitle Studio Pro — subtitle/editor.js
   Right-hand editor: current-subtitle form, capture strip ([ ] Enter workflow),
   and a virtualized subtitle list that stays smooth at 100k rows. */
"use strict";
SSP.editor = (() => {
  const $ = SSP.dom.$;
  const ROW_H = 56;
  let scrollEl, sizerEl;
  let pendingStart = null;      // "[" pressed, waiting for "]"
  let editingId = null;

  /* ================= Capture workflow ================= */
  function markStart() {
    pendingStart = SSP.player.time;
    updateCaptureStrip();
    SSP.toast("[ " + SSP.time.fmt(pendingStart));
  }

  function markEnd() {
    const t = SSP.player.time;
    if (pendingStart == null || t <= pendingStart) {
      // "]" alone: set end of selected subtitle to playhead
      const sel = SSP.model.selected;
      if (sel && t > sel.start) { SSP.model.update(sel.id, { end: t }); syncForm(); }
      else SSP.toast(SSP.i18n.t("capture_idle"));
      return;
    }
    const sub = SSP.model.add({ start: pendingStart, end: t, text: "" });
    pendingStart = null;
    updateCaptureStrip();
    SSP.model.select(sub.id, true);          // focuses textarea (see select handler)
  }

  function updateCaptureStrip() {
    const strip = $("#captureStrip");
    strip.classList.toggle("armed", pendingStart != null);
    $("#capMsg").textContent = SSP.i18n.t(pendingStart != null ? "capture_armed" : "capture_idle");
    $("#capTc").textContent = pendingStart != null ? SSP.time.fmt(pendingStart) : "";
  }

  /* ================= Form ================= */
  function syncForm() {
    const s = SSP.model.selected;
    editingId = s ? s.id : null;
    const on = !!s;
    ["#edStart", "#edEnd", "#edText"].forEach(sel => $(sel).disabled = !on);
    ["#btnDelSub", "#btnSplit", "#btnMerge", "#btnDup"].forEach(sel => $(sel).disabled = !on);
    if (!s) {
      $("#edStart").value = ""; $("#edEnd").value = ""; $("#edDur").value = "";
      $("#edText").value = ""; $("#edNum").textContent = "—";
      updMeta(); return;
    }
    $("#edNum").textContent = "#" + (SSP.model.index(s.id) + 1);
    $("#edStart").value = SSP.time.fmt(s.start);
    $("#edEnd").value = SSP.time.fmt(s.end);
    $("#edDur").value = (s.end - s.start).toFixed(3) + "s";
    if (document.activeElement !== $("#edText")) $("#edText").value = s.text;
    updMeta();
  }

  function updMeta() {
    const s = SSP.model.selected;
    const text = s ? $("#edText").value : "";
    const chars = text.replace(/\n/g, "").length;
    const lines = text ? text.split("\n").length : 0;
    const cps = s ? (chars / Math.max(0.001, s.end - s.start)) : 0;
    $("#mChars").textContent = chars;
    $("#mLines").textContent = lines;
    const el = $("#mCps");
    el.textContent = cps.toFixed(1);
    el.className = cps > 21 ? "bad" : cps > 17 ? "warnc" : "";
  }

  function commitTimes() {
    const s = SSP.model.selected; if (!s) return;
    const st = SSP.time.parse($("#edStart").value);
    const en = SSP.time.parse($("#edEnd").value);
    $("#edStart").classList.toggle("invalid", !isFinite(st));
    $("#edEnd").classList.toggle("invalid", !isFinite(en) || en <= st);
    if (isFinite(st) && isFinite(en) && en > st) SSP.model.update(s.id, { start: st, end: en });
  }

  const commitText = SSP.debounce(() => {
    const s = SSP.model.selected; if (!s) return;
    if ($("#edText").value !== s.text) SSP.model.update(s.id, { text: $("#edText").value }, { silent: true });
    SSP.bus.emit("model:change");
  }, 350);

  function saveAndAdvance() {
    const s = SSP.model.selected; if (!s) return;
    SSP.model.update(s.id, { text: $("#edText").value });
    SSP.toast("✓ " + SSP.i18n.t("saved"), "ok", 900);
    $("#edText").blur();
    if (SSP.player.hasVideo && SSP.player.video.paused) SSP.player.video.play();
  }

  /* ================= Virtualized list ================= */
  const renderList = SSP.throttleRAF(() => {
    const subs = SSP.model.all();
    const total = subs.length;
    sizerEl.style.height = total * ROW_H + "px";
    $("#listCount").textContent = total ? `(${total})` : "";
    $("#emptyListMsg").classList.toggle("hidden", total > 0);

    const top = scrollEl.scrollTop, vh = scrollEl.clientHeight;
    const first = Math.max(0, Math.floor(top / ROW_H) - 4);
    const last = Math.min(total, Math.ceil((top + vh) / ROW_H) + 4);

    // reuse pool
    const pool = sizerEl.children;
    let pi = 0;
    const selId = SSP.model.selectedId;
    for (let i = first; i < last; i++, pi++) {
      const s = subs[i];
      let row = pool[pi];
      if (!row) {
        row = SSP.dom.el("div", { class: "sub-row", role: "listitem" }, [
          SSP.dom.el("span", { class: "n" }), SSP.dom.el("span", { class: "t" }),
          SSP.dom.el("span", { class: "t" }), SSP.dom.el("span", { class: "txt" }),
          SSP.dom.el("span", { class: "cps" })
        ]);
        row.addEventListener("click", () => {
          const id = +row.dataset.id;
          SSP.model.select(id, false);
          const sub = SSP.model.get(id);
          if (sub) SSP.player.seek(sub.start);
        });
        row.addEventListener("dblclick", () => SSP.model.select(+row.dataset.id, true));
        sizerEl.append(row);
      }
      row.style.top = i * ROW_H + "px";
      row.dataset.id = s.id;
      row.classList.toggle("sel", s.id === selId);
      const c = row.children;
      c[0].textContent = i + 1;
      c[1].textContent = SSP.time.fmt(s.start).slice(0, 11);
      c[2].textContent = SSP.time.fmt(s.end).slice(0, 11);
      c[3].textContent = s.text || "· · ·";
      const cps = SSP.model.cps(s);
      c[4].textContent = isFinite(cps) ? cps.toFixed(0) : "—";
      c[4].className = "cps" + (cps > 21 ? " bad" : cps > 17 ? " warnc" : "");
    }
    // hide unused pool rows
    for (; pi < pool.length; pi++) pool[pi].style.top = "-9999px";
  });

  function scrollToSelected() {
    const id = SSP.model.selectedId; if (id == null) return;
    const i = SSP.model.index(id); if (i < 0) return;
    const y = i * ROW_H;
    if (y < scrollEl.scrollTop || y + ROW_H > scrollEl.scrollTop + scrollEl.clientHeight)
      scrollEl.scrollTop = y - scrollEl.clientHeight / 2 + ROW_H / 2;
  }

  /* ================= Init ================= */
  function init() {
    scrollEl = $("#subListScroll"); sizerEl = $("#subListSizer");
    scrollEl.addEventListener("scroll", renderList, { passive: true });
    new ResizeObserver(renderList).observe(scrollEl);

    $("#edStart").addEventListener("change", commitTimes);
    $("#edEnd").addEventListener("change", commitTimes);
    $("#edText").addEventListener("input", () => { updMeta(); commitText(); });
    $("#edText").addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveAndAdvance(); }
      e.stopPropagation();                 // typing must not trigger global shortcuts
    });
    ["#edStart", "#edEnd"].forEach(sel =>
      $(sel).addEventListener("keydown", e => e.stopPropagation()));

    $("#btnAddSub").addEventListener("click", () => {
      const t = SSP.player.time;
      SSP.model.add({ start: t, end: t + 2, text: "" });
    });
    $("#btnDelSub").addEventListener("click", () => {
      const s = SSP.model.selected;
      if (s) SSP.model.remove(s.id);
    });
    $("#btnSplit").addEventListener("click", () => {
      const s = SSP.model.selected;
      if (s) SSP.model.split(s.id, SSP.player.time > s.start && SSP.player.time < s.end ? SSP.player.time : (s.start + s.end) / 2);
    });
    $("#btnMerge").addEventListener("click", () => {
      const s = SSP.model.selected; if (s) SSP.model.mergeWithNext(s.id);
    });
    $("#btnDup").addEventListener("click", () => {
      const s = SSP.model.selected; if (s) SSP.model.duplicate(s.id);
    });
    $("#btnMarkStart").addEventListener("click", markStart);
    $("#btnMarkEnd").addEventListener("click", markEnd);

    SSP.bus.on("model:change", () => { syncForm(); renderList(); });
    SSP.bus.on("model:softchange", () => { syncForm(); renderList(); });
    SSP.bus.on("model:select", (id, focus) => {
      syncForm(); renderList(); scrollToSelected();
      if (focus && id != null) setTimeout(() => { $("#edText").focus(); $("#edText").select(); }, 0);
    });
    SSP.bus.on("i18n:change", updateCaptureStrip);

    updateCaptureStrip();
    syncForm();
    renderList();
  }

  return { init, markStart, markEnd, saveAndAdvance, get pendingStart() { return pendingStart; } };
})();
