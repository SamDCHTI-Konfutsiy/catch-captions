/* Subtitle Studio Pro — utils/ffmpeg.js
   Shared FFmpeg.wasm loader. Single-thread UMD core: no COOP/COEP headers
   needed, works from file://. Engine downloads once (~30 MB) and is reused
   for the whole session; all processing is local. */
"use strict";
SSP.ffmpeg = (() => {
  let instance = null;      // { ff, fetchFile }
  let loading = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("Failed to load " + src));
      document.head.append(s);
    });
  }

  /** Returns { ff, fetchFile }. Safe to call repeatedly / concurrently. */
  async function get() {
    if (instance) return instance;
    if (loading) return loading;
    loading = (async () => {
      await loadScript("https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js");
      await loadScript("https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js");
      const { FFmpeg } = window.FFmpegWASM;
      const { fetchFile, toBlobURL } = window.FFmpegUtil;
      // IMPORTANT: whenever classWorkerURL is supplied, this library always spawns
      // the worker as {type:"module"}. A module worker has no importScripts(), so
      // the worker falls back to `(await import(coreURL)).default` — which means
      // coreURL MUST be a genuine ES module with a default export. The UMD core
      // build has no such export (it assigns a global instead) and fails with
      // "failed to import ffmpeg-core.js". The ESM core build fixes this.
      const coreBase = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      const workerBase = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd";  // self-contained, no import statements — safe in either worker type
      const ff = new FFmpeg();
      ff.on("progress", ({ progress }) => {
        const pct = Math.max(0, Math.min(1, progress || 0));
        SSP.bus.emit("status", `FFmpeg ${Math.round(pct * 100)}%`);
        SSP.bus.emit("ffmpeg:progress", pct);
      });
      const coreURL = await toBlobURL(`${coreBase}/ffmpeg-core.js`, "text/javascript");
      const wasmURL = await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, "application/wasm");
      try {
        // On file:// and any cross-origin CDN (unpkg vs. the page's own origin) a
        // Worker can't be created from that CDN's URL directly — every piece must
        // go through blob: URLs, which the browser treats as same-origin.
        const classWorkerURL = await toBlobURL(`${workerBase}/814.ffmpeg.js`, "text/javascript");
        await ff.load({ classWorkerURL, coreURL, wasmURL });
      } catch (e) {
        console.warn("blob-worker load failed, retrying plain:", e?.message || e);
        await ff.load({ coreURL, wasmURL });
      }
      instance = { ff, fetchFile };
      loading = null;
      return instance;
    })().catch(e => { loading = null; throw e; });
    return loading;
  }

  /** Best-effort cleanup of files written to MEMFS. */
  async function rm(ff, names) {
    for (const n of names) { try { await ff.deleteFile(n); } catch (_) {} }
  }

  return { get, rm };
})();
