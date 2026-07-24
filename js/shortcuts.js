/* Subtitle Studio Pro — shortcuts.js
   Global keyboard map. Inputs/textareas stop propagation themselves, so
   everything here fires only in "app" focus context. */
"use strict";
SSP.shortcuts = (() => {

  const typing = () => {
    const a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
  };

  function onKey(e) {
    if (typing()) return;
    const mod = e.ctrlKey || e.metaKey;
    const P = SSP.player, M = SSP.model, E = SSP.editor;

    /* --- with modifier --- */
    if (mod) {
      switch (e.key.toLowerCase()) {
        case "z": e.preventDefault(); e.shiftKey ? M.redo() : M.undo(); return;
        case "y": e.preventDefault(); M.redo(); return;
        case "c": e.preventDefault(); M.copy(); return;
        case "v": e.preventDefault(); M.paste(P.time); SSP.toast(SSP.i18n.t("pasted")); return;
        case "d": e.preventDefault(); if (M.selected) M.duplicate(M.selectedId); return;
        case "f": e.preventDefault(); SSP.search.open(); return;
        case "s": e.preventDefault(); SSP.project.saveNow(); return;
        case "arrowleft": e.preventDefault(); P.jump(-10); return;
        case "arrowright": e.preventDefault(); P.jump(10); return;
      }
      return;
    }
    if (e.altKey) {
      if (e.key === "ArrowLeft") { e.preventDefault(); P.jump(-30); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); P.jump(30); return; }
      return;
    }

    /* --- bare keys --- */
    switch (e.key) {
      case " ": e.preventDefault(); P.playPause(); break;
      case "[": e.preventDefault(); E.markStart(); break;
      case "]": e.preventDefault(); E.markEnd(); break;
      case "Enter": {
        const s = M.selected;
        if (s) { e.preventDefault(); M.select(s.id, true); }  // jump into text editing
        break;
      }
      case "Delete": case "Backspace": {
        const s = M.selected;
        if (s) { e.preventDefault(); M.remove(s.id); }
        break;
      }
      case "ArrowLeft": e.preventDefault(); e.shiftKey ? P.jump(-5) : P.frameStep(-1); break;
      case "ArrowRight": e.preventDefault(); e.shiftKey ? P.jump(5) : P.frameStep(1); break;
      case "ArrowUp": {
        e.preventDefault();
        const i = M.selectedId != null ? M.index(M.selectedId) : 0;
        const prev = M.all()[Math.max(0, i - 1)];
        if (prev) { M.select(prev.id, false); P.seek(prev.start); }
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        const i = M.selectedId != null ? M.index(M.selectedId) : -1;
        const next = M.all()[Math.min(M.count() - 1, i + 1)];
        if (next) { M.select(next.id, false); P.seek(next.start); }
        break;
      }
      case "s": { const s = M.selected; if (s) M.split(s.id, P.time > s.start && P.time < s.end ? P.time : (s.start + s.end) / 2); break; }
      case "m": { const s = M.selected; if (s) M.mergeWithNext(s.id); break; }
      case "f": SSP.player.fullscreen(); break;
      case "l": SSP.player.toggleLoopSelection(); break;
      case "+": case "=": SSP.timeline.zoomIn(); break;
      case "-": SSP.timeline.zoomOut(); break;
      case "Escape":
        SSP.dom.$$(".modal-backdrop:not(.hidden)").forEach(m => {
          if (m.id && m.id !== "ffmpegOffer") m.classList.add("hidden"); else m.remove();
        });
        break;
    }
  }

  function init() { document.addEventListener("keydown", onKey); }
  return { init };
})();
