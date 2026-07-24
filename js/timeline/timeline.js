/* Subtitle Studio Pro — timeline/timeline.js
   Windowed canvas timeline: time ruler, waveform lane, subtitle blocks with
   drag-to-move and edge resize, zoom (buttons / ctrl+wheel), pan, playhead follow.
   Renders only the visible window → smooth with 100k cues. */
"use strict";
SSP.timeline = (() => {
  const $ = SSP.dom.$;
  let canvas, ctx, wrap;
  let pxPerSec = 80;                    // zoom
  let viewStart = 0;                    // seconds at left edge
  let follow = true;
  let dpr = 1;
  let W = 0, H = 0;                     // css px
  const RULER_H = 26;
  let waveH = 0, blockY = 0, blockH = 0;

  // interaction state
  let drag = null;   // {mode:'move'|'resizeL'|'resizeR'|'scrub'|'pan', id, grabOffset, startX, startViewStart, orig}
  const EDGE = 6;

  const mins = new Float32Array(4096), maxs = new Float32Array(4096);

  const t2x = t => (t - viewStart) * pxPerSec;
  const x2t = x => viewStart + x / pxPerSec;

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  let C = {};
  function refreshColors() {
    C = {
      bg: cssVar("--bg-1"), line: cssVar("--line-soft"), tx2: cssVar("--tx-2"), tx3: cssVar("--tx-3"),
      accent: cssVar("--accent"), block: cssVar("--block"), blockLine: cssVar("--block-line"),
      wave: cssVar("--wave"), waveHi: cssVar("--wave-hi"), playhead: cssVar("--playhead"),
      warn: cssVar("--warn"), danger: cssVar("--danger"), bg2: cssVar("--bg-2")
    };
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = wrap.clientWidth; H = wrap.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    waveH = Math.max(30, Math.round((H - RULER_H) * 0.42));
    blockY = RULER_H + waveH + 4;
    blockH = H - blockY - 6;
    draw();
  }

  /* ---------------- Drawing ---------------- */
  function niceStep() {
    const target = 90 / pxPerSec;      // ~90px between labels
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    for (const s of steps) if (s >= target) return s;
    return 3600;
  }

  function draw() {
    if (!ctx) return;
    refreshColors();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const dur = SSP.player.duration || Math.max(60, lastSubEnd() + 10);
    const t0 = viewStart, t1 = viewStart + W / pxPerSec;

    /* ruler */
    ctx.fillStyle = C.bg2;
    ctx.fillRect(0, 0, W, RULER_H);
    const step = niceStep();
    const first = Math.floor(t0 / step) * step;
    ctx.strokeStyle = C.line; ctx.fillStyle = C.tx3;
    ctx.font = "10px " + getComputedStyle(document.body).getPropertyValue("--font-mono");
    ctx.textBaseline = "middle";
    ctx.beginPath();
    for (let t = first; t <= t1 + step; t += step) {
      const x = Math.round(t2x(t)) + 0.5;
      ctx.moveTo(x, RULER_H - 8); ctx.lineTo(x, RULER_H);
      ctx.fillText(step < 1 ? t.toFixed(1) : SSP.time.fmtShort(t), x + 3, RULER_H / 2);
      // minor ticks
      for (let k = 1; k < 5; k++) {
        const xm = Math.round(t2x(t + step * k / 5)) + 0.5;
        ctx.moveTo(xm, RULER_H - 4); ctx.lineTo(xm, RULER_H);
      }
    }
    ctx.stroke();
    ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.moveTo(0, RULER_H + .5); ctx.lineTo(W, RULER_H + .5); ctx.stroke();

    /* out-of-media shading */
    if (dur < t1) {
      ctx.fillStyle = "rgba(127,127,127,.08)";
      ctx.fillRect(t2x(dur), RULER_H, W - t2x(dur), H - RULER_H);
    }

    /* waveform */
    const buckets = Math.min(mins.length, W | 0);
    const mid = RULER_H + waveH / 2;
    if (buckets > 0 && SSP.waveform.read(t0, t1, buckets, mins, maxs)) {
      ctx.fillStyle = C.wave;
      const colW = W / buckets;
      ctx.beginPath();
      for (let b = 0; b < buckets; b++) {
        const x = b * colW;
        const yTop = mid + maxs[b] * (waveH / 2) * -1;
        const yBot = mid + mins[b] * (waveH / 2) * -1;
        ctx.rect(x, Math.min(yTop, yBot), Math.max(1, colW), Math.max(1, Math.abs(yBot - yTop)));
      }
      ctx.fill();
    } else {
      ctx.strokeStyle = C.line;
      ctx.beginPath(); ctx.moveTo(0, mid + .5); ctx.lineTo(W, mid + .5); ctx.stroke();
    }

    /* subtitle blocks (windowed) */
    const subs = SSP.model.inRange(t0 - 60, t1 + 60);   // small pad so labels don't pop
    const selId = SSP.model.selectedId;
    ctx.textBaseline = "middle";
    ctx.font = "11px " + getComputedStyle(document.body).fontFamily;
    for (const s of subs) {
      const x = t2x(s.start), w = Math.max(2, (s.end - s.start) * pxPerSec);
      if (x > W || x + w < 0) continue;
      const sel = s.id === selId;
      ctx.fillStyle = sel ? C.accent : C.block;
      ctx.globalAlpha = sel ? 0.95 : 0.8;
      roundRect(ctx, x, blockY, w, blockH, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = sel ? C.accent : C.blockLine;
      roundRect(ctx, x + .5, blockY + .5, w - 1, blockH - 1, 5);
      ctx.stroke();
      if (w > 34) {
        ctx.save();
        ctx.beginPath(); ctx.rect(x + 4, blockY, w - 8, blockH); ctx.clip();
        ctx.fillStyle = sel ? "#032622" : cssVar("--tx-1");
        const firstLine = s.text.split("\n")[0] || "";
        ctx.fillText(firstLine, x + 6, blockY + blockH / 2);
        ctx.restore();
      }
      // resize grips when selected
      if (sel && w > 14) {
        ctx.fillStyle = "rgba(255,255,255,.7)";
        ctx.fillRect(x + 2, blockY + 4, 2, blockH - 8);
        ctx.fillRect(x + w - 4, blockY + 4, 2, blockH - 8);
      }
    }

    /* playhead */
    const px = t2x(SSP.player.time);
    if (px >= -1 && px <= W + 1) {
      ctx.strokeStyle = C.playhead;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = C.playhead;
      ctx.beginPath();
      ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 8); ctx.closePath(); ctx.fill();
    }
  }

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function lastSubEnd() {
    const a = SSP.model.all();
    return a.length ? a[a.length - 1].end : 0;
  }

  const redraw = SSP.throttleRAF(draw);

  /* ---------------- Zoom / pan ---------------- */
  function setZoom(z, anchorX = W / 2) {
    const tAnchor = x2t(anchorX);
    pxPerSec = SSP.time.clamp(z, 2, 600);
    viewStart = Math.max(0, tAnchor - anchorX / pxPerSec);
    $("#zoomLbl").textContent = pxPerSec >= 10 ? Math.round(pxPerSec) + " px/s" : pxPerSec.toFixed(1) + " px/s";
    redraw();
  }
  const zoomIn = () => setZoom(pxPerSec * 1.4);
  const zoomOut = () => setZoom(pxPerSec / 1.4);
  function fit() {
    const dur = SSP.player.duration || lastSubEnd() || 60;
    viewStart = 0;
    setZoom(Math.max(2, (W - 20) / dur), 0);
  }

  function ensureVisible(t) {
    const t1 = viewStart + W / pxPerSec;
    if (t < viewStart || t > t1) {
      viewStart = Math.max(0, t - (W / pxPerSec) * 0.3);
      redraw();
    }
  }

  /* ---------------- Pointer interaction ---------------- */
  function hitTest(x, y) {
    const t = x2t(x);
    if (y < RULER_H) return { zone: "ruler", t };
    if (y < blockY) return { zone: "wave", t };
    const subs = SSP.model.inRange(t - 30, t + 30);
    // topmost = latest start under cursor
    for (let i = subs.length - 1; i >= 0; i--) {
      const s = subs[i];
      const sx = t2x(s.start), ex = t2x(s.end);
      if (x >= sx - EDGE && x <= ex + EDGE) {
        if (Math.abs(x - sx) <= EDGE) return { zone: "edgeL", sub: s, t };
        if (Math.abs(x - ex) <= EDGE) return { zone: "edgeR", sub: s, t };
        if (x >= sx && x <= ex) return { zone: "block", sub: s, t };
      }
    }
    return { zone: "empty", t };
  }

  function onPointerDown(e) {
    canvas.setPointerCapture(e.pointerId);
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = hitTest(x, y);
    follow = false; syncFollowBtn();
    if (hit.zone === "ruler" || hit.zone === "wave") {
      drag = { mode: "scrub" };
      SSP.player.seek(hit.t);
    } else if (hit.zone === "edgeL" || hit.zone === "edgeR") {
      SSP.model.select(hit.sub.id, false);
      drag = { mode: hit.zone === "edgeL" ? "resizeL" : "resizeR", id: hit.sub.id, orig: { ...hit.sub } };
      canvas.classList.add("resizing");
    } else if (hit.zone === "block") {
      SSP.model.select(hit.sub.id, false);
      drag = { mode: "move", id: hit.sub.id, grabOffset: hit.t - hit.sub.start, orig: { ...hit.sub } };
      canvas.classList.add("grabbing");
    } else {
      drag = { mode: "pan", startX: e.clientX, startViewStart: viewStart };
      canvas.classList.add("grabbing");
    }
    redraw();
  }

  function onPointerMove(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (!drag) {
      const hit = hitTest(x, y);
      canvas.style.cursor =
        hit.zone === "edgeL" || hit.zone === "edgeR" ? "ew-resize" :
        hit.zone === "block" ? "grab" :
        hit.zone === "ruler" || hit.zone === "wave" ? "text" : "default";
      return;
    }
    const t = x2t(x);
    if (drag.mode === "scrub") SSP.player.seek(t);
    else if (drag.mode === "pan") {
      viewStart = Math.max(0, drag.startViewStart - (e.clientX - drag.startX) / pxPerSec);
      redraw();
    } else if (drag.mode === "move") {
      const s = SSP.model.get(drag.id); if (!s) return;
      const d = s.end - s.start;
      let ns = Math.max(0, t - drag.grabOffset);
      SSP.model.update(drag.id, { start: ns, end: ns + d }, { silent: true });
      redraw(); SSP.bus.emit("model:softchange", drag.id);
    } else if (drag.mode === "resizeL") {
      const s = SSP.model.get(drag.id); if (!s) return;
      SSP.model.update(drag.id, { start: SSP.time.clamp(t, 0, s.end - 0.05) }, { silent: true });
      redraw(); SSP.bus.emit("model:softchange", drag.id);
    } else if (drag.mode === "resizeR") {
      const s = SSP.model.get(drag.id); if (!s) return;
      SSP.model.update(drag.id, { end: Math.max(s.start + 0.05, t) }, { silent: true });
      redraw(); SSP.bus.emit("model:softchange", drag.id);
    }
  }

  function onPointerUp() {
    if (drag && (drag.mode === "move" || drag.mode === "resizeL" || drag.mode === "resizeR")) {
      SSP.bus.emit("model:change");           // full refresh + autosave mark after gesture
    }
    drag = null;
    canvas.classList.remove("grabbing", "resizing");
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = canvas.getBoundingClientRect();
      setZoom(pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left);
    } else {
      const delta = (e.deltaX || e.deltaY) / pxPerSec;
      viewStart = Math.max(0, viewStart + delta);
      follow = false; syncFollowBtn();
      redraw();
    }
  }

  function onDblClick(e) {
    const r = canvas.getBoundingClientRect();
    const hit = hitTest(e.clientX - r.left, e.clientY - r.top);
    if (hit.zone === "block") { SSP.model.select(hit.sub.id, true); SSP.player.seek(hit.sub.start); }
    else if (hit.zone === "empty") {
      const s = SSP.model.add({ start: hit.t, end: hit.t + 2, text: "" });
      SSP.player.seek(s.start);
    }
  }

  function syncFollowBtn() {
    $("#btnFollow").classList.toggle("primary", follow);
    $("#btnFollow").classList.toggle("btn", true);
  }

  /* ---------------- Init ---------------- */
  function init() {
    wrap = $("#tlCanvasWrap"); canvas = $("#tlCanvas");
    ctx = canvas.getContext("2d");
    new ResizeObserver(resize).observe(wrap);
    resize();

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDblClick);

    $("#btnZoomIn").addEventListener("click", zoomIn);
    $("#btnZoomOut").addEventListener("click", zoomOut);
    $("#btnFit").addEventListener("click", fit);
    $("#btnFollow").addEventListener("click", () => { follow = !follow; syncFollowBtn(); });
    syncFollowBtn();

    SSP.bus.on("model:change", redraw);
    SSP.bus.on("model:select", id => { const s = SSP.model.get(id); if (s) ensureVisible(s.start); redraw(); });
    SSP.bus.on("waveform:ready", redraw);
    SSP.bus.on("waveform:progress", SSP.debounce(redraw, 300));
    SSP.bus.on("theme:change", redraw);
    SSP.bus.on("player:time", t => {
      if (follow && !drag) {
        const t1 = viewStart + W / pxPerSec;
        if (t > t1 - (W / pxPerSec) * 0.1 || t < viewStart)
          viewStart = Math.max(0, t - (W / pxPerSec) * 0.15);
      }
      redraw();
    });
    SSP.bus.on("video:ready", fit);
  }

  return { init, zoomIn, zoomOut, fit, ensureVisible, get pxPerSec() { return pxPerSec; } };
})();
