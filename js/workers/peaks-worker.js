/* Subtitle Studio Pro — workers/peaks-worker.js
   Downsamples PCM channel data into min/max peak pairs off the main thread.
   Used when the app is served over http(s); on file:// the app automatically
   falls back to the inline chunked implementation (browsers block workers
   from file:// URLs). */
"use strict";
self.onmessage = e => {
  const { ch0, ch1, sampleRate, pps, totalPairs } = e.data;
  const peaks = new Float32Array(totalPairs * 2);
  const spp = sampleRate / pps;
  for (let i = 0; i < totalPairs; i++) {
    const s0 = Math.floor(i * spp), s1 = Math.min(ch0.length, Math.floor((i + 1) * spp));
    let mn = 0, mx = 0;
    for (let s = s0; s < s1; s += 2) {
      let v = ch0[s]; if (ch1) v = (v + ch1[s]) * 0.5;
      if (v < mn) mn = v; else if (v > mx) mx = v;
    }
    peaks[i * 2] = mn; peaks[i * 2 + 1] = mx;
    if ((i & 8191) === 0) self.postMessage({ progress: i / totalPairs });
  }
  self.postMessage({ peaks }, [peaks.buffer]);
};
