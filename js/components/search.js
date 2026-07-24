/* Subtitle Studio Pro — components/search.js
   Find / replace / replace-all, filters (duplicates, empty, too long),
   and the quality-check report modal. */
"use strict";
SSP.search = (() => {
  const $ = SSP.dom.$, el = SSP.dom.el, T = () => SSP.i18n.t;

  function buildMatcher() {
    const q = $("#sFind").value;
    if (!q) return null;
    const flags = $("#sCase").checked ? "g" : "gi";
    try {
      return $("#sRegex").checked
        ? new RegExp(q, flags)
        : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch (e) { SSP.toast("Regex: " + e.message, "err"); return null; }
  }

  function currentResults() {
    const t = T();
    const rx = buildMatcher();
    const fDup = $("#sDup").checked, fEmpty = $("#sEmpty").checked, fLong = $("#sLong").checked;
    const subs = SSP.model.all();
    const seen = new Map();
    const out = [];
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      let match = true, why = "";
      if (rx) { rx.lastIndex = 0; match = rx.test(s.text); }
      if (match && fEmpty) { match = !s.text.trim(); why = t("filter_empty"); }
      if (match && fLong) {
        const tooLong = s.text.split("\n").some(l => l.length > 42) || SSP.model.cps(s) > 21;
        match = tooLong; if (tooLong) why = t("filter_long");
      }
      if (match && fDup) {
        const key = s.text.trim();
        if (!key) match = false;
        else if (seen.has(key)) { why = t("filter_dup") + " #" + (seen.get(key) + 1); }
        else { seen.set(key, i); match = false; }
      }
      if (match) out.push({ i, s, why });
    }
    return out;
  }

  const refresh = SSP.debounce(() => {
    const list = $("#sResults");
    list.innerHTML = "";
    const res = currentResults();
    $("#sCount").textContent = `${res.length} ${T()("results")}`;
    const frag = document.createDocumentFragment();
    for (const r of res.slice(0, 500)) {         // cap DOM; counts stay exact
      frag.append(el("div", {
        class: "item",
        onclick: () => { SSP.model.select(r.s.id, false); SSP.player.seek(r.s.start); }
      }, [
        el("span", { class: "meta", text: "#" + (r.i + 1) }),
        el("span", { class: "meta", text: SSP.time.fmt(r.s.start).slice(0, 8) }),
        el("span", { class: "grow", text: r.s.text.replace(/\n/g, " ⏎ ") || "· · ·" }),
        r.why ? el("span", { class: "chip warn", text: r.why }) : null
      ]));
    }
    list.append(frag);
  }, 200);

  function replaceInSelected() {
    const rx = buildMatcher(); if (!rx) return;
    const s = SSP.model.selected || currentResults()[0]?.s;
    if (!s) return;
    const nt = s.text.replace(rx, $("#sReplace").value);
    if (nt !== s.text) SSP.model.update(s.id, { text: nt });
    refresh();
  }

  function replaceAll() {
    const rx = buildMatcher(); if (!rx) return;
    const rep = $("#sReplace").value;
    let n = 0;
    const changes = [];
    for (const s of SSP.model.all()) {
      rx.lastIndex = 0;
      const nt = s.text.replace(rx, rep);
      if (nt !== s.text) { changes.push([s.id, nt]); n++; }
    }
    if (n) {
      SSP.model.batch(() => {
        for (const [id, nt] of changes) SSP.model.update(id, { text: nt }, { silent: true });
      });
    }
    SSP.toast(`${T()("replace_all")}: ${n}`);
    refresh();
  }

  function open() {
    $("#searchModal").classList.remove("hidden");
    $("#sFind").focus();
    refresh();
  }
  function close() { $("#searchModal").classList.add("hidden"); }

  /* ---------------- QC report ---------------- */
  function openQC() {
    const t = T();
    const issues = SSP.model.qc();
    const list = $("#qcResults");
    list.innerHTML = "";
    $("#qcSummary").textContent = issues.length
      ? `${issues.filter(i => i.sev === "err").length} err · ${issues.filter(i => i.sev === "warn").length} warn · ${issues.filter(i => i.sev === "info").length} info`
      : t("qc_clean");
    const frag = document.createDocumentFragment();
    for (const iss of issues.slice(0, 1000)) {
      const s = SSP.model.get(iss.id); if (!s) continue;
      frag.append(el("div", {
        class: "item",
        onclick: () => { SSP.model.select(iss.id, false); SSP.player.seek(s.start); }
      }, [
        el("span", { class: `chip ${iss.sev}`, text: iss.sev }),
        el("span", { class: "meta", text: "#" + (SSP.model.index(iss.id) + 1) }),
        el("span", { class: "grow", text: iss.msg }),
        el("span", { class: "meta", text: SSP.time.fmt(s.start).slice(0, 8) })
      ]));
    }
    list.append(frag);
    $("#qcModal").classList.remove("hidden");
  }
  const closeQC = () => $("#qcModal").classList.add("hidden");

  function init() {
    $("#btnSearch").addEventListener("click", open);
    $("#searchClose").addEventListener("click", close);
    $("#searchModal").addEventListener("click", e => { if (e.target.id === "searchModal") close(); });
    ["#sFind", "#sReplace"].forEach(s => $(s).addEventListener("keydown", e => e.stopPropagation()));
    ["#sFind", "#sCase", "#sRegex", "#sDup", "#sEmpty", "#sLong"]
      .forEach(sel => $(sel).addEventListener("input", refresh));
    $("#btnReplaceOne").addEventListener("click", replaceInSelected);
    $("#btnReplaceAll").addEventListener("click", replaceAll);

    $("#btnQC").addEventListener("click", openQC);
    $("#qcClose").addEventListener("click", closeQC);
    $("#qcModal").addEventListener("click", e => { if (e.target.id === "qcModal") closeQC(); });
  }

  return { init, open, close, openQC };
})();
