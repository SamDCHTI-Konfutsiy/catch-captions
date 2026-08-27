/* Subtitle Studio Pro — asr/asr.js
   Automatic subtitles with Whisper running IN THE BROWSER via transformers.js.
   - The AI model downloads once (then cached by the browser); the audio/video
     itself NEVER leaves the device — inference is 100% local (WebGPU or WASM).
   - Audio is decoded to 16 kHz mono and transcribed in 30 s windows so we can
     show real progress and support cancellation; window-relative timestamps
     are offset back to absolute time.
   - Results are inserted as ONE undo step. Cancelling keeps what's done so far. */
"use strict";
SSP.asr = (() => {
  const $ = SSP.dom.$;
  const CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2";
  const WINDOW = 30;                       // Whisper's native context, seconds
  const STRIDE = 25;                       // window step → 5 s overlap between windows
  const EDGE   = 1.5;                      // trailing seconds treated as unreliable
  const MODELS = {
    tiny:  "onnx-community/whisper-tiny",
    base:  "onnx-community/whisper-base",
    small: "onnx-community/whisper-small"
  };

  let lib = null;                          // transformers.js module
  let pipe = null, pipeKey = "";           // cached pipeline per model
  let running = false, cancelled = false;

  /* ---------------- audio: source → 16 kHz mono windows ----------------
     Returns { duration, getWindow(t0,t1)->Float32Array }.
     Three paths, chosen by size:
       1. decode straight into a 16 kHz AudioContext          (small/medium files)
       2. native-rate decode + downsample (waveform's path)   (fallback for small)
       3. FFmpeg.wasm → 16 kHz mono WAV, parsed directly      (large files & any codec)
     Path 3 exists because decoding a 2h movie in one AudioBuffer needs ~3 GB and
     hits Chrome's tab memory limit; WAV int16 is ~6x smaller and windows are
     converted to Float32 on demand (2 MB per 30 s window). */

  async function getBytes(src) {
    if (src.file) return src.file.arrayBuffer();           // cheap re-read from disk
    const r = await fetch(src.url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.arrayBuffer();
  }

  const fromFloat = (data, duration) => ({
    duration,
    getWindow: (t0, t1) => data.subarray(Math.floor(t0 * 16000), Math.floor(t1 * 16000))
  });

  function decode16k(AC) {
    return async src => {
      const ctx = new AC({ sampleRate: 16000 });
      try {
        const audio = await ctx.decodeAudioData(await getBytes(src));
        const ch0 = audio.getChannelData(0);
        const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
        if (!ch1) return fromFloat(ch0, audio.duration);
        const mono = new Float32Array(ch0.length);
        for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
        return fromFloat(mono, audio.duration);
      } finally { ctx.close().catch(() => {}); }
    };
  }

  function decodeNativeDown(AC) {
    return async src => {
      const ctx = new AC();
      try {
        const audio = await ctx.decodeAudioData(await getBytes(src));
        const ch0 = audio.getChannelData(0);
        const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
        const ratio = audio.sampleRate / 16000;
        const outLen = Math.floor(audio.length / ratio);
        const out = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const j = (i * ratio) | 0;
          out[i] = ch1 ? (ch0[j] + ch1[j]) * 0.5 : ch0[j];
        }
        return fromFloat(out, audio.duration);
      } finally { ctx.close().catch(() => {}); }
    };
  }

  /** Minimal RIFF/WAV parser → PCM s16le mono view. */
  function parseWav(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = o => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");
    let o = 12, sampleRate = 0, channels = 0, bits = 0, dataOfs = -1, dataLen = 0;
    while (o + 8 <= bytes.length) {
      const id = tag(o), size = dv.getUint32(o + 4, true);
      if (id === "fmt ") {
        channels = dv.getUint16(o + 10, true);
        sampleRate = dv.getUint32(o + 12, true);
        bits = dv.getUint16(o + 22, true);
      } else if (id === "data") { dataOfs = o + 8; dataLen = size; break; }
      o += 8 + size + (size & 1);
    }
    if (dataOfs < 0) throw new Error("WAV data chunk not found");
    if (sampleRate !== 16000 || channels !== 1 || bits !== 16) throw new Error("Unexpected WAV format");
    if (dataOfs + dataLen > bytes.length) dataLen = bytes.length - dataOfs;
    const abs = bytes.byteOffset + dataOfs;
    const pcm = (abs % 2 === 0)
      ? new Int16Array(bytes.buffer, abs, dataLen >> 1)
      : new Int16Array(bytes.buffer.slice(abs, abs + (dataLen & ~1)));
    return pcm;
  }

  async function viaFFmpegWav(src) {
    setStatus(SSP.i18n.t("asr_extract"));
    setBar(0.15);
    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      setStatus(`${SSP.i18n.t("asr_extract")} (${secs}s)`);
    }, 1000);
    const onProgress = pct => {
      setBar(0.15 + 0.15 * pct);
      setStatus(`${SSP.i18n.t("asr_extract")} — ${Math.round(pct * 100)}%`);
    };
    SSP.bus.on("ffmpeg:progress", onProgress);
    let ff = null, inName = null;
    try {
      ({ ff } = await SSP.ffmpeg.get());
      setStatus(SSP.i18n.t("asr_extract") + " (" + SSP.i18n.t("asr_reading_file") + ")");
      const { fetchFile } = await SSP.ffmpeg.get();
      inName = "in." + (src.file ? (SSP.extname(src.file.name) || "bin") : "bin");
      await ff.writeFile(inName, await fetchFile(src.file || src.url));
      await ff.exec(["-i", inName, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "a.wav"]);
      const wav = await ff.readFile("a.wav");
      const pcm = parseWav(wav);
      const duration = pcm.length / 16000;
      return {
        duration,
        getWindow(t0, t1) {
          const a = Math.floor(t0 * 16000), b = Math.min(pcm.length, Math.floor(t1 * 16000));
          const out = new Float32Array(Math.max(0, b - a));
          for (let i = a; i < b; i++) out[i - a] = pcm[i] / 32768;
          return out;
        }
      };
    } finally {
      clearInterval(heartbeat);
      SSP.bus.off("ffmpeg:progress", onProgress);
      if (ff) SSP.ffmpeg.rm(ff, [inName, "a.wav"].filter(Boolean));  // free MEMFS (input can be 700+ MB)
    }
  }


  async function getAudio16k() {
    const src = SSP.player.source;
    if (!src || (!src.file && !src.url)) throw new Error(SSP.i18n.t("asr_no_video"));
    setStatus(SSP.i18n.t("asr_decoding"));
    const AC = window.AudioContext || window.webkitAudioContext;
    // Large media: one-shot decode would need gigabytes → go straight to FFmpeg+WAV.
    const big = (SSP.player.duration > 2400) || ((src.file?.size || 0) > 300 * 1024 * 1024);
    const attempts = big
      ? [viaFFmpegWav]
      : [decode16k(AC), decodeNativeDown(AC), viaFFmpegWav];
    let lastErr = null;
    for (const attempt of attempts) {
      try {
        const audio = await attempt(src);
        if (audio.duration > 3 * 3600) throw new Error("Audio longer than 3h");
        return audio;
      } catch (e) {
        if (/longer than/.test(e?.message || "")) throw e;
        lastErr = e;
        console.warn("audio path failed:", e?.message || e);
      }
    }
    if (src.url && /HTTP |Failed to fetch|NetworkError/i.test(lastErr?.message || "")) throw new Error(SSP.i18n.t("asr_cors"));
    if (!navigator.onLine) throw new Error(SSP.i18n.t("asr_offline"));
    const detail = (lastErr?.message || String(lastErr || "")).slice(0, 140);
    throw new Error(SSP.i18n.t("asr_decode_fail") + (detail ? ` [${detail}]` : ""));
  }

  /* ---------------- model loading ---------------- */
  async function getPipeline(modelId) {
    if (!lib) {
      setStatus(SSP.i18n.t("asr_loading_lib"));
      lib = await import(/* webpackIgnore: true */ CDN);
      lib.env.allowLocalModels = false;
    }
    const key = modelId;
    if (pipe && pipeKey === key) return pipe;
    if (pipe) { try { await pipe.dispose(); } catch (_) {} pipe = null; }

    const progress_callback = p => {
      if (p.status === "progress" && p.total) {
        const pct = p.progress ?? (p.loaded / p.total * 100);
        setStatus(`${SSP.i18n.t("asr_loading_model")} — ${SSP.basename(p.file || "")} ${pct.toFixed(0)}%`);
        setBar(pct * 0.01 * 0.15);          // model download = first 15% of the bar
      }
    };
    try {                                    // prefer GPU, fall back to WASM
      // IMPORTANT: q8 on WebGPU produces corrupted, repetitive output on many GPUs.
      // The known-good WebGPU config (used by the official whisper-webgpu demo) is
      // an fp32 encoder with a q4 merged decoder.
      pipe = await lib.pipeline("automatic-speech-recognition", modelId, {
        device: "webgpu",
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        progress_callback
      });
    } catch (e) {
      console.warn("WebGPU unavailable, using WASM:", e?.message || e);
      pipe = await lib.pipeline("automatic-speech-recognition", modelId, {
        device: "wasm", dtype: "q8", progress_callback
      });
    }
    pipeKey = key;
    return pipe;
  }

  /* ---------------- output hygiene ---------------- */
  /** RMS of a slice — windows that are basically silent make Whisper hallucinate,
      so we skip them entirely. */
  function rms(a) {
    let sum = 0;
    const step = Math.max(1, (a.length / 8000) | 0);      // sample ~8k points
    let n = 0;
    for (let i = 0; i < a.length; i += step) { sum += a[i] * a[i]; n++; }
    return Math.sqrt(sum / Math.max(1, n));
  }

  /** Degenerate-repetition detector ("col deadareaingu col deadareaingu …").
      Works for spaced scripts via token ratio and for CJK via 3-gram ratio. */
  function isHallucination(text) {
    if (text.length > 600) return true;                    // no real cue is this long
    // consecutive repetition: a 15+ char phrase doubled, or a 5+ char phrase 4×
    // ("col deadareaingu col deadareaingu …" / "Easubby …эфф Easubby …эфф")
    if (/(.{15,160}?)\1/.test(text) || /(.{5,40}?)\1{3,}/.test(text)) return true;
    // script salad: one spoken utterance never legitimately mixes 3+ writing systems
    // (Whisper garbage looks like "palabra那就 relacion 이건 theories")
    let scripts = 0;
    for (const re of [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u,
                      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
                      /\p{Script=Hangul}/u, /\p{Script=Arabic}/u, /\p{Script=Greek}/u,
                      /\p{Script=Hebrew}/u, /\p{Script=Thai}/u, /\p{Script=Devanagari}/u])
      if (re.test(text)) scripts++;
    if (scripts >= 3) return true;
    const toks = text.split(/\s+/).filter(Boolean);
    if (toks.length >= 8) {
      const uniq = new Set(toks.map(t => t.toLowerCase()));
      if (uniq.size / toks.length < 0.35) return true;     // same words over and over
    }
    if (text.length >= 24) {
      const grams = new Set();
      for (let i = 0; i + 3 <= text.length; i++) grams.add(text.slice(i, i + 3));
      if (grams.size / (text.length - 2) < 0.22) return true;
    }
    return false;
  }

  /* ---------------- timing hygiene ----------------
     Reading-speed aware cleanup. The old version capped a cue's minimum
     duration at 0.8 s, which is well below what a viewer can actually read.
     Now each cue gets the time its text needs (CPS-based), stretched into the
     silence before the next cue — that space is free, so there is no reason
     to leave it unused. */
  const MIN_DUR = 1.10;      // absolute floor, seconds
  const MAX_DUR = 7.00;
  const MAX_CPS = 17;        // characters per second, spaced scripts
  const MAX_CPS_CJK = 9;     // ideographic scripts pack more meaning per glyph
  const MIN_GAP = 0.08;      // smallest gap between consecutive cues

  const isCJK = t => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(t);
  const charCount = t => t.replace(/\s+/g, "").length;

  /** How long this text needs on screen to be comfortably readable. */
  function idealDur(text) {
    const cps = isCJK(text) ? MAX_CPS_CJK : MAX_CPS;
    return Math.min(MAX_DUR, Math.max(MIN_DUR, charCount(text) / cps));
  }

  /** Overlapping windows produce the same line twice; keep the better copy. */
  function dedupe(cues) {
    const out = [];
    for (const c of cues.sort((a, b) => a.start - b.start)) {
      const prev = out[out.length - 1];
      if (!prev) { out.push(c); continue; }
      const near = Math.abs(c.start - prev.start) < 1.2;
      const a = prev.text.replace(/\s+/g, ""), b = c.text.replace(/\s+/g, "");
      const same = a === b || (a.length > 6 && b.length > 6 && (a.includes(b) || b.includes(a)));
      if (near && same) {
        if (b.length > a.length) prev.text = c.text;   // longer copy is less truncated
        prev.start = Math.min(prev.start, c.start);
        prev.end = Math.max(prev.end, c.end);
        continue;
      }
      out.push(c);
    }
    return out;
  }

  /** Whisper often splits one sentence into several stubs; glue them back. */
  function mergeFragments(cues) {
    const out = [];
    for (const c of cues) {
      const prev = out[out.length - 1];
      const tiny = charCount(c.text) <= 4 || (c.end - c.start) < 0.45;
      const close = prev && (c.start - prev.end) < 0.30;
      const fits = prev && charCount(prev.text + c.text) <= 84;
      const unfinished = prev && !/[.!?。！？…]["»”』」]?$/.test(prev.text.trim());
      if (prev && close && fits && (tiny || unfinished) && (c.end - prev.start) <= MAX_DUR) {
        prev.text = (prev.text.trim() + " " + c.text.trim()).replace(/\s+/g, " ");
        prev.end = c.end;
        continue;
      }
      out.push(c);
    }
    return out;
  }

  /** Give every cue the time its text needs, using the silence that follows. */
  function stretchIntoGaps(cues, duration) {
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i], next = cues[i + 1];
      const limit = next ? next.start - MIN_GAP : duration;
      const want = c.start + idealDur(c.text);
      if (c.end < want) c.end = Math.min(want, limit);
      if (c.end < c.start + 0.25) c.end = Math.min(c.start + 0.25, limit);
    }
    return cues;
  }

  function sanitize(cues, duration) {
    let list = [];
    for (const c of cues) {
      const text = (c.text || "").trim();
      if (!text || isHallucination(text)) continue;
      let s = Math.max(0, c.start), e = Math.min(duration, c.end);
      if (e <= s) e = s + 0.3;
      list.push({ start: s, end: e, text });
    }
    list = dedupe(list);
    list = mergeFragments(list);

    for (let i = 1; i < list.length; i++) {                 // keep times monotonic
      if (list[i].start < list[i - 1].end + MIN_GAP)
        list[i].start = Math.min(list[i].end - 0.2, list[i - 1].end + MIN_GAP);
      if (list[i].start < 0) list[i].start = 0;
    }
    list = list.filter(c => c.end > c.start);
    list = stretchIntoGaps(list, duration);

    return list.filter(c => {
      if (c.end > duration) c.end = duration;
      if (c.end - c.start > MAX_DUR) c.end = c.start + MAX_DUR;
      return c.end > c.start + 0.15;
    });
  }

  /* ---------------- transcription ---------------- */
  async function run() {
    if (running) return;
    running = true; cancelled = false;
    $("#btnAsrStart").disabled = true;
    $("#btnAsrCancel").disabled = false;
    $("#asrPreview").textContent = "";
    setBar(0);
    const cues = [];
    try {
      const sel = $("#asrModel").value;
      let modelId;
      if (sel === "custom") {
        modelId = $("#asrCustomId").value.trim();
        if (!modelId) { SSP.toast(SSP.i18n.t("asr_custom_ph"), "err", 4000); return; }
      } else modelId = MODELS[sel] || MODELS.base;
      const lang = $("#asrLang").value;      // "" = auto-detect
      const asr = await getPipeline(modelId);
      const audio = await getAudio16k();
      const duration = audio.duration;

      const genOpts = { task: "transcribe", return_timestamps: true };
      if (lang) genOpts.language = lang;

      for (let t0 = 0; t0 < duration; t0 += STRIDE) {
        if (cancelled) break;
        const t1 = Math.min(duration, t0 + WINDOW);
        if (t1 - t0 < 0.4) break;
        const isLast = t1 >= duration - 0.01;
        setStatus(`${SSP.i18n.t("asr_transcribing")} — ${SSP.time.fmtShort(t0)} / ${SSP.time.fmtShort(duration)}`);
        const slice = audio.getWindow(t0, t1);
        if (rms(slice) < 0.004) { setBar(0.30 + 0.70 * (t1 / duration)); continue; }  // silence → skip
        const out = await asr(slice, genOpts);

        /* Windows overlap by WINDOW-STRIDE seconds, so a word cut at one
           window's edge is heard whole in the next one. Cues that start in the
           unreliable tail are dropped here — the following window covers them
           with better context. The final window keeps everything. */
        const tailCut = isLast ? Infinity : (t1 - t0) - EDGE;

        for (const c of (out.chunks || [])) {
          const text = (c.text || "").trim();
          if (!text) continue;
          let [s, e] = c.timestamp || [0, null];
          s = s ?? 0;
          e = e ?? (t1 - t0);
          if (s >= tailCut) continue;                 // belongs to the next window
          s += t0; e += t0;
          if (e <= s) e = s + 0.5;
          cues.push({ start: Math.min(s, duration), end: Math.min(e, duration), text });
        }
        if (!out.chunks?.length && (out.text || "").trim())
          cues.push({ start: t0, end: t1, text: out.text.trim() });

        const last = cues[cues.length - 1];
        if (last) $("#asrPreview").textContent = SSP.time.fmtShort(last.start) + "  " + last.text;
        setBar(0.30 + 0.70 * (t1 / duration));   // transcription = remaining 70%
      }

      const clean = sanitize(cues, duration);
      if (clean.length) {
        SSP.model.batch(() => {
          for (const c of clean) SSP.model.add(c, { silent: true, select: false });
        });
      }
      setBar(1);
      SSP.toast(
        (cancelled ? SSP.i18n.t("asr_partial") : SSP.i18n.t("asr_done")) + ": " + clean.length,
        cancelled ? "" : "ok", 4000
      );
      if (!cancelled) close();
    } catch (e) {
      console.error(e);
      setStatus(SSP.i18n.t("asr_fail") + ": " + (e?.message || e));
      SSP.toast(SSP.i18n.t("asr_fail"), "err", 5000);
    } finally {
      running = false;
      $("#btnAsrStart").disabled = false;
      $("#btnAsrCancel").disabled = true;
    }
  }

  /* ---------------- UI ---------------- */
  const setStatus = m => { $("#asrStatus").textContent = m; };
  const setBar = f => { $("#asrBarFill").style.width = (SSP.time.clamp(f, 0, 1) * 100).toFixed(1) + "%"; };
  const open = () => {
    if (!SSP.player.hasVideo) { SSP.toast(SSP.i18n.t("asr_no_video"), "err"); return; }
    if ($("#asrModel").value === "custom" && !$("#asrCustomId").value.trim()) {
      $("#asrModel").value = "base";
      $("#asrCustomId").classList.add("hidden");
    }
    setStatus(""); setBar(0);
    $("#asrModal").classList.remove("hidden");
  };
  const close = () => $("#asrModal").classList.add("hidden");

  function init() {
    $("#btnAsr").addEventListener("click", open);
    $("#asrModel").addEventListener("change", () =>
      $("#asrCustomId").classList.toggle("hidden", $("#asrModel").value !== "custom"));
    $("#asrCustomId").addEventListener("keydown", e => e.stopPropagation());
    $("#asrClose").addEventListener("click", () => { cancelled = true; close(); });
    $("#asrModal").addEventListener("click", e => { if (e.target.id === "asrModal") { cancelled = true; close(); } });
    $("#btnAsrStart").addEventListener("click", run);
    $("#btnAsrCancel").addEventListener("click", () => { cancelled = true; });
  }

  return { init, open };
})();
