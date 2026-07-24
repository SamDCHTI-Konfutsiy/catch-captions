/* Subtitle Studio Pro — timeline/waveform.js
   Local waveform generation: decode audio with Web Audio, downsample to
   min/max peak pairs, expose windowed reads for the timeline canvas. */
"use strict";
SSP.waveform = (() => {
  let peaks = null;         // Float32Array [min0,max0,min1,max1,...]
  let pps = 0;              // peak pairs per second
  let durationSec = 0;
  let building = false;

  function reset() { peaks = null; pps = 0; durationSec = 0; SSP.bus.emit("waveform:ready"); }

  async function build(file, duration) {
    if (building) return;
    if (!file || file.size > 900 * 1024 * 1024) { reset(); return; }   // skip decode >900MB
    building = true;
    SSP.bus.emit("status", SSP.i18n.t("waveform_building"));
    try {
      const buf = await file.arrayBuffer();
      await decode(buf, duration);
    } catch (e) {
      console.warn("waveform:", e);
      reset();
      SSP.toast(SSP.i18n.t("waveform_fail"), "", 3000);
    } finally {
      building = false;
      SSP.bus.emit("status", "");
    }
  }

  async function buildFromURL(url, duration) {
    if (building) return;
    building = true;
    try {
      const res = await fetch(url, { mode: "cors" });
      const len = +res.headers.get("content-length") || 0;
      if (len > 900 * 1024 * 1024) throw new Error("too large");
      const buf = await res.arrayBuffer();
      await decode(buf, duration);
    } catch (e) {
      console.warn("waveform url:", e);
      reset();
    } finally { building = false; }
  }

  async function decode(arrayBuffer, duration) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    try {
      const audio = await ctx.decodeAudioData(arrayBuffer);
      durationSec = audio.duration || duration || 0;
      // resolution: 100 pairs/sec short media, 40 pairs/sec beyond 30 min
      pps = durationSec > 1800 ? 40 : 100;
      const totalPairs = Math.ceil(durationSec * pps);
      peaks = new Float32Array(totalPairs * 2);
      const ch0 = audio.getChannelData(0);
      const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;

      // Prefer the worker (http/https only — file:// blocks workers) for media ≤ 60 min
      if (location.protocol.startsWith("http") && durationSec <= 3600) {
        try {
          peaks = await workerPeaks(ch0, ch1, audio.sampleRate, totalPairs);
          SSP.bus.emit("waveform:ready");
          return;
        } catch (e) { console.warn("peaks worker fallback:", e); }
      }

      const spp = audio.sampleRate / pps;                  // samples per pair
      const CHUNK = 2000;                                  // pairs per yield — keeps UI responsive
      for (let p = 0; p < totalPairs; p += CHUNK) {
        const end = Math.min(p + CHUNK, totalPairs);
        for (let i = p; i < end; i++) {
          const s0 = Math.floor(i * spp), s1 = Math.min(ch0.length, Math.floor((i + 1) * spp));
          let mn = 0, mx = 0;
          for (let s = s0; s < s1; s += 2) {               // stride 2: half the reads, same shape
            let v = ch0[s]; if (ch1) v = (v + ch1[s]) * 0.5;
            if (v < mn) mn = v; else if (v > mx) mx = v;
          }
          peaks[i * 2] = mn; peaks[i * 2 + 1] = mx;
        }
        SSP.bus.emit("waveform:progress", end / totalPairs);
        await new Promise(r => setTimeout(r, 0));
      }
      SSP.bus.emit("waveform:ready");
    } finally { ctx.close(); }
  }

  function workerPeaks(ch0, ch1, sampleRate, totalPairs) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker("js/workers/peaks-worker.js"); }
      catch (e) { reject(e); return; }
      const c0 = ch0.slice(), c1 = ch1 ? ch1.slice() : null;   // copies → transferable
      const transfers = [c0.buffer]; if (c1) transfers.push(c1.buffer);
      w.onerror = e => { w.terminate(); reject(e); };
      w.onmessage = e => {
        if (e.data.progress !== undefined) { SSP.bus.emit("waveform:progress", e.data.progress); return; }
        w.terminate(); resolve(e.data.peaks);
      };
      w.postMessage({ ch0: c0, ch1: c1, sampleRate, pps, totalPairs }, transfers);
    });
  }

  /** Fill target min/max arrays for [t0,t1] across `buckets` columns. Returns false if no data. */
  function read(t0, t1, buckets, mins, maxs) {
    if (!peaks || !pps) return false;
    const pairsTotal = peaks.length / 2;
    for (let b = 0; b < buckets; b++) {
      const ta = t0 + (t1 - t0) * (b / buckets);
      const tb = t0 + (t1 - t0) * ((b + 1) / buckets);
      let p0 = Math.max(0, Math.floor(ta * pps));
      let p1 = Math.min(pairsTotal, Math.max(p0 + 1, Math.ceil(tb * pps)));
      let mn = 0, mx = 0;
      for (let p = p0; p < p1; p++) {
        const a = peaks[p * 2], c = peaks[p * 2 + 1];
        if (a < mn) mn = a;
        if (c > mx) mx = c;
      }
      mins[b] = mn; maxs[b] = mx;
    }
    return true;
  }

  return { build, buildFromURL, read, reset, get hasData() { return !!peaks; } };
})();
