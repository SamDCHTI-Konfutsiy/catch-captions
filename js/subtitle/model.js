/* Subtitle Studio Pro — subtitle/model.js
   Sorted subtitle store + command-based unlimited undo/redo + quality checks.
   Emits: model:change (structure/content), model:select (selection). */
"use strict";
SSP.model = (() => {
  let subs = [];                 // sorted by start, then end
  let selectedId = null;
  let undoStack = [], redoStack = [];
  let batchOps = null;           // when non-null, ops accumulate into one undo step
  let dirty = false;

  const byId = id => subs.findIndex(s => s.id === id);
  const cmp = (a, b) => (a.start - b.start) || (a.end - b.end) || (a.id - b.id);

  function insertSorted(sub) {
    let lo = 0, hi = subs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; cmp(subs[mid], sub) < 0 ? lo = mid + 1 : hi = mid; }
    subs.splice(lo, 0, sub);
  }

  function emitChange() { dirty = true; SSP.bus.emit("model:change"); }

  /* ---------------- Undo core ---------------- */
  // op: {do:{type,...}, undo:{type,...}}
  function apply(op) {
    switch (op.type) {
      case "add": insertSorted({ ...op.sub }); break;
      case "remove": { const i = byId(op.id); if (i >= 0) subs.splice(i, 1); break; }
      case "patch": {
        const i = byId(op.id); if (i < 0) break;
        const s = subs[i];
        Object.assign(s, op.fields);
        subs.splice(i, 1); insertSorted(s);       // keep order after time edits
        break;
      }
    }
  }

  function record(doOp, undoOp) {
    apply(doOp);
    const pair = { do: doOp, undo: undoOp };
    if (batchOps) batchOps.push(pair);
    else { undoStack.push([pair]); redoStack.length = 0; }
  }

  function beginBatch() { if (!batchOps) batchOps = []; }
  function endBatch() {
    if (batchOps && batchOps.length) { undoStack.push(batchOps); redoStack.length = 0; }
    batchOps = null;
  }

  function undo() {
    const step = undoStack.pop();
    if (!step) return false;
    for (let i = step.length - 1; i >= 0; i--) apply(step[i].undo);
    redoStack.push(step);
    if (selectedId !== null && byId(selectedId) < 0) select(null, false);
    emitChange();
    return true;
  }
  function redo() {
    const step = redoStack.pop();
    if (!step) return false;
    for (const p of step) apply(p.do);
    if (selectedId !== null && byId(selectedId) < 0) select(null, false);
    emitChange();
    return true;
  }

  /* ---------------- CRUD ---------------- */
  function add({ start, end, text = "" }, opts = {}) {
    start = Math.max(0, +start || 0);
    end = Math.max(start + 0.001, +end || start + 2);
    const sub = { id: SSP.uid(), start, end, text: String(text) };
    record({ type: "add", sub: { ...sub } }, { type: "remove", id: sub.id });
    if (!opts.silent) emitChange();
    if (opts.select !== false) select(sub.id);
    return sub;
  }

  function update(id, fields, opts = {}) {
    const i = byId(id); if (i < 0) return null;
    const s = subs[i];
    const before = {}; const after = {};
    for (const k of ["start", "end", "text"]) {
      if (k in fields && fields[k] !== s[k]) { before[k] = s[k]; after[k] = fields[k]; }
    }
    if (!Object.keys(after).length) return s;
    if ("start" in after) after.start = Math.max(0, +after.start);
    if ("end" in after) after.end = +after.end;
    record({ type: "patch", id, fields: after }, { type: "patch", id, fields: before });
    if (!opts.silent) emitChange();
    return subs[byId(id)];
  }

  function remove(id, opts = {}) {
    const i = byId(id); if (i < 0) return;
    const sub = { ...subs[i] };
    record({ type: "remove", id }, { type: "add", sub });
    if (selectedId === id) selectedId = null;
    if (!opts.silent) emitChange();
  }

  function removeMany(ids) {
    beginBatch();
    ids.forEach(id => remove(id, { silent: true }));
    endBatch();
    emitChange();
  }

  function duplicate(id) {
    const s = get(id); if (!s) return null;
    const shift = s.end - s.start + 0.1;
    return add({ start: s.start + shift, end: s.end + shift, text: s.text });
  }

  function split(id, atTime) {
    const s = get(id); if (!s) return;
    const t = SSP.time.clamp(atTime, s.start + 0.05, s.end - 0.05);
    const lines = s.text.split("\n");
    const half = Math.ceil(lines.length / 2);
    const t1 = lines.slice(0, half).join("\n"), t2 = lines.slice(half).join("\n");
    beginBatch();
    update(id, { end: t, text: t1 }, { silent: true });
    add({ start: t, end: s.end, text: t2 }, { silent: true, select: false });
    endBatch();
    emitChange();
  }

  function mergeWithNext(id) {
    const i = byId(id); if (i < 0 || i >= subs.length - 1) return;
    const a = subs[i], b = subs[i + 1];
    beginBatch();
    update(a.id, { end: Math.max(a.end, b.end), text: (a.text + "\n" + b.text).trim() }, { silent: true });
    remove(b.id, { silent: true });
    endBatch();
    select(a.id, false);
    emitChange();
  }

  /* ---------------- Clipboard ---------------- */
  let clip = null;
  function copy(id) { const s = get(id ?? selectedId); if (s) { clip = { ...s }; SSP.toast(SSP.i18n.t("copied")); } }
  function paste(atTime) {
    if (!clip) return;
    const d = clip.end - clip.start;
    const start = atTime != null ? atTime : clip.start + d + 0.1;
    add({ start, end: start + d, text: clip.text });
  }

  /* ---------------- Selection / queries ---------------- */
  function select(id, focusEditor = true) {
    selectedId = id;
    SSP.bus.emit("model:select", id, focusEditor);
  }
  const get = id => subs.find(s => s.id === id) || null;
  const index = id => byId(id);
  const all = () => subs;
  const count = () => subs.length;

  function atTime(t) {
    // linear scan is fine only for tiny sets; use binary search on start then check window
    let lo = 0, hi = subs.length - 1, res = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; subs[m].start <= t ? (res = m, lo = m + 1) : hi = m - 1; }
    for (let i = res; i >= 0 && i > res - 60; i--)     // subtitles rarely nest deeper
      if (subs[i].start <= t && t < subs[i].end) return subs[i];
    return null;
  }

  /** Subtitles overlapping [t0,t1) — binary search + short back-walk, O(log n + k) */
  function inRange(t0, t1) {
    const out = [];
    let lo = 0, hi = subs.length;                     // first index with start >= t0
    while (lo < hi) { const m = (lo + hi) >> 1; subs[m].start < t0 ? lo = m + 1 : hi = m; }
    for (let i = lo - 1; i >= 0 && i > lo - 400; i--) // long cues starting earlier
      if (subs[i].end > t0) out.push(subs[i]);
    out.reverse();
    for (let i = lo; i < subs.length && subs[i].start < t1; i++) out.push(subs[i]);
    return out;
  }

  function replaceAll(newSubs, label) {
    beginBatch();
    for (const s of [...subs]) remove(s.id, { silent: true });
    for (const s of newSubs) add({ start: s.start, end: s.end, text: s.text }, { silent: true, select: false });
    endBatch();
    select(null, false);
    emitChange();
    if (label) SSP.toast(label);
  }

  /* ---------------- Quality checks ---------------- */
  const cps = s => {
    const d = s.end - s.start;
    const chars = s.text.replace(/\n/g, "").length;
    return d > 0 ? chars / d : Infinity;
  };

  function qc(opts = {}) {
    const cfg = Object.assign({ maxCPS: 21, minDur: 0.7, maxDur: 7, maxLineLen: 42, maxLines: 2, minGap: 0.08 }, opts);
    const issues = [];
    const T = SSP.i18n.t;
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i], d = s.end - s.start;
      if (!s.text.trim()) issues.push({ id: s.id, sev: "warn", code: "empty", msg: T("qc_empty") });
      const c = cps(s);
      if (c > cfg.maxCPS && s.text.trim()) issues.push({ id: s.id, sev: "err", code: "cps", msg: `${T("qc_cps")}: ${c.toFixed(1)} > ${cfg.maxCPS}` });
      if (d < cfg.minDur) issues.push({ id: s.id, sev: "warn", code: "short", msg: `${T("qc_short")}: ${d.toFixed(2)}s` });
      if (d > cfg.maxDur) issues.push({ id: s.id, sev: "warn", code: "long", msg: `${T("qc_long")}: ${d.toFixed(1)}s` });
      for (const line of s.text.split("\n"))
        if (line.length > cfg.maxLineLen) { issues.push({ id: s.id, sev: "warn", code: "linelen", msg: `${T("qc_linelen")}: ${line.length} > ${cfg.maxLineLen}` }); break; }
      if (s.text.split("\n").length > cfg.maxLines) issues.push({ id: s.id, sev: "info", code: "lines", msg: T("qc_lines") });
      if (i < subs.length - 1) {
        const n = subs[i + 1];
        if (n.start < s.end - 0.001) issues.push({ id: s.id, sev: "err", code: "overlap", msg: `${T("qc_overlap")} #${i + 2}` });
        else if (n.start - s.end > 0 && n.start - s.end < cfg.minGap)
          issues.push({ id: s.id, sev: "info", code: "gap", msg: `${T("qc_gap")}: ${((n.start - s.end) * 1000) | 0}ms` });
      }
    }
    return issues;
  }

  /** Group multiple mutations into a single undo step */
  function batch(fn) { beginBatch(); try { fn(); } finally { endBatch(); } emitChange(); }

  return {
    add, update, remove, removeMany, duplicate, split, mergeWithNext, batch,
    copy, paste, undo, redo,
    canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0,
    select, get, index, all, count, atTime, inRange, replaceAll,
    cps, qc,
    get selectedId() { return selectedId; },
    get selected() { return get(selectedId); },
    isDirty: () => dirty, markClean: () => { dirty = false; },
    /** Load raw array without polluting undo history (project open) */
    load(arr) {
      subs = arr.map(s => ({ id: SSP.uid(), start: +s.start, end: +s.end, text: String(s.text ?? "") }))
                .sort(cmp);
      undoStack = []; redoStack = []; selectedId = null; dirty = false;
      SSP.bus.emit("model:change"); SSP.bus.emit("model:select", null, false);
    },
    serializeState: () => subs.map(s => ({ id: s.id, start: s.start, end: s.end, text: s.text }))
  };
})();
