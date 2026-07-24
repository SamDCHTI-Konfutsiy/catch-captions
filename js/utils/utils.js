/* Subtitle Studio Pro — utils/utils.js
   Global namespace, event bus, time helpers, DOM helpers, misc. */
"use strict";
window.SSP = window.SSP || {};

/* ---------------- Event bus ---------------- */
SSP.bus = (() => {
  const map = new Map();
  return {
    on(ev, fn) { (map.get(ev) || map.set(ev, new Set()).get(ev)).add(fn); return fn; },
    off(ev, fn) { map.get(ev)?.delete(fn); },
    emit(ev, ...args) { map.get(ev)?.forEach(fn => { try { fn(...args); } catch (e) { console.error(`[bus:${ev}]`, e); } }); }
  };
})();

/* ---------------- Time helpers ---------------- */
SSP.time = {
  clamp(v, a, b) { return Math.min(b, Math.max(a, v)); },

  /** seconds -> "HH:MM:SS.mmm" (sep customizable) */
  fmt(sec, sep = ".") {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const ms = Math.round(sec * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    const mm = ms % 1000;
    const p = (n, l = 2) => String(n).padStart(l, "0");
    return `${p(h)}:${p(m)}:${p(s)}${sep}${p(mm, 3)}`;
  },

  /** short "MM:SS" for ruler labels */
  fmtShort(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
    const p = n => String(n).padStart(2, "0");
    return h ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
  },

  /** Parse "HH:MM:SS.mmm", "HH:MM:SS,mmm", "MM:SS.mmm", "SS.mmm", "H:MM:SS:FF" -> seconds. NaN if invalid. */
  parse(str) {
    if (typeof str !== "string") return NaN;
    str = str.trim().replace(",", ".");
    if (!str) return NaN;
    const parts = str.split(":");
    if (parts.length > 4) return NaN;
    let sec = 0;
    for (const p of parts) {
      if (!/^\d*\.?\d*$/.test(p) || p === "" || p === ".") return NaN;
      sec = sec * 60 + parseFloat(p);
    }
    return isFinite(sec) ? sec : NaN;
  }
};

/* ---------------- DOM helpers ---------------- */
SSP.dom = {
  $(sel, root = document) { return root.querySelector(sel); },
  $$(sel, root = document) { return [...root.querySelectorAll(sel)]; },
  el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) n.append(c);
    return n;
  },
  esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }
};

/* ---------------- Toast notifications ---------------- */
SSP.toast = (msg, type = "", ms = 2600) => {
  const wrap = document.getElementById("toasts");
  if (!wrap) return;
  const t = SSP.dom.el("div", { class: `toast ${type}`, role: "status", text: msg });
  wrap.append(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .25s"; setTimeout(() => t.remove(), 260); }, ms);
};

/* ---------------- Downloads / file pickers ---------------- */
SSP.download = (filename, content, mime = "text/plain;charset=utf-8") => {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = SSP.dom.el("a", { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

SSP.pickFile = (accept, multiple = false) => new Promise(resolve => {
  const inp = SSP.dom.el("input", { type: "file", accept, class: "hidden" });
  if (multiple) inp.multiple = true;
  inp.addEventListener("change", () => resolve(multiple ? [...inp.files] : inp.files[0] || null));
  document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
});

SSP.readText = file => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsText(file);
});

/* ---------------- Misc ---------------- */
SSP.uid = (() => { let n = Date.now() % 1e7; return () => ++n; })();
SSP.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
SSP.throttleRAF = fn => { let queued = false; return (...a) => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(...a); }); }; };
SSP.basename = name => (name || "").replace(/\.[^.]+$/, "");
SSP.extname = name => { const m = /\.([^.]+)$/.exec(name || ""); return m ? m[1].toLowerCase() : ""; };
