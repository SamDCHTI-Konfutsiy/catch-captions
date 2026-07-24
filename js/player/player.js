/* Subtitle Studio Pro — player/player.js
   Video loading, transport controls, live subtitle overlay, loop, screenshots,
   FFmpeg.wasm fallback for formats the browser can't decode. */
"use strict";
SSP.player = (() => {
  const $ = SSP.dom.$;
  let video, seekbar, timecode, overlay, overlayText;
  let currentFile = null, currentURL = null, objectURL = null;
  let loop = null;               // {start, end} for loop-selection
  let fps = 25;                  // frame step assumption; refined via callback if supported
  let rafId = 0;

  const FRAME = () => 1 / fps;

  /* ---------------- Loading ---------------- */
  let corsRetried = false;

  async function loadFile(file) {
    stopFFmpegNotice();
    revoke();
    corsRetried = false;
    video.removeAttribute("crossorigin");
    currentFile = file; currentURL = null;
    objectURL = URL.createObjectURL(file);
    video.src = objectURL;
    $("#dropHint").classList.add("hidden");
    SSP.bus.emit("video:loading", { name: file.name, file });
    await SSP.db.addRecent({ key: "v:" + file.name, kind: "video", name: file.name }).catch(() => {});
    SSP.bus.emit("recents:changed");
  }

  function loadURL(url) {
    stopFFmpegNotice();
    revoke();
    corsRetried = false;
    currentFile = null; currentURL = url;
    video.crossOrigin = "anonymous";       // allows waveform/screenshot when server sends CORS headers
    video.src = url;
    $("#dropHint").classList.add("hidden");
    SSP.bus.emit("video:loading", { name: url.split("/").pop() || url, url });
    SSP.db.addRecent({ key: "u:" + url, kind: "url", name: url, url }).catch(() => {});
    SSP.bus.emit("recents:changed");
  }

  function revoke() { if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; } }

  /* ---------------- FFmpeg.wasm fallback ---------------- */
  let ffmpegBusy = false;
  function stopFFmpegNotice() { $("#ffmpegOffer")?.remove(); }

  function offerFFmpeg() {
    if (!currentFile || ffmpegBusy || $("#ffmpegOffer")) return;
    const t = SSP.i18n.t;
    const box = SSP.dom.el("div", { id: "ffmpegOffer", class: "modal-backdrop" }, [
      SSP.dom.el("div", { class: "modal", role: "dialog", "aria-modal": "true" }, [
        SSP.dom.el("h2", { text: t("video_error") }),
        SSP.dom.el("p", { class: "hint", text: t("convert_ffmpeg") }),
        SSP.dom.el("div", { class: "row" }, [
          SSP.dom.el("button", { class: "btn primary", text: "FFmpeg →", onclick: () => { box.remove(); runFFmpeg(); } }),
          SSP.dom.el("button", { class: "btn outline", text: t("cancel"), onclick: () => box.remove() })
        ])
      ])
    ]);
    document.body.append(box);
  }

  async function runFFmpeg() {
    const t = SSP.i18n.t;
    ffmpegBusy = true;
    SSP.toast(t("converting"), "", 6000);
    try {
      const { ff, fetchFile } = await SSP.ffmpeg.get();
      const inName = "in." + (SSP.extname(currentFile.name) || "bin");
      await ff.writeFile(inName, await fetchFile(currentFile));
      // Try stream copy into MP4 first (fast); fall back to re-encode.
      try {
        await ff.exec(["-i", inName, "-c", "copy", "-movflags", "+faststart", "out.mp4"]);
      } catch (_) {
        await ff.exec(["-i", inName, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "out.mp4"]);
      }
      const data = await ff.readFile("out.mp4");
      const blob = new Blob([data.buffer], { type: "video/mp4" });
      const converted = new File([blob], SSP.basename(currentFile.name) + ".converted.mp4", { type: "video/mp4" });
      ffmpegBusy = false;
      loadFile(converted);
      SSP.toast("✓ FFmpeg", "ok");
    } catch (e) {
      ffmpegBusy = false;
      console.error(e);
      SSP.toast("FFmpeg: " + (navigator.onLine ? e.message : "offline — converter download requires internet once"), "err", 5000);
    }
  }


  /* ---------------- Transport ---------------- */
  const playPause = () => { video.src ? (video.paused ? video.play() : video.pause()) : null; };
  const seek = t => { if (video.src) video.currentTime = SSP.time.clamp(t, 0, video.duration || 0); };
  const jump = dt => seek(video.currentTime + dt);
  const frameStep = dir => { video.pause(); seek(video.currentTime + dir * FRAME()); };

  function setSpeed(v) { video.playbackRate = +v; }

  function toggleLoopSelection() {
    const s = SSP.model.selected;
    if (loop) { loop = null; SSP.toast("Loop off"); return; }
    if (!s) { SSP.toast(SSP.i18n.t("nothing_selected"), "err"); return; }
    loop = { start: s.start, end: s.end };
    seek(loop.start); video.play();
    SSP.toast("Loop: " + SSP.time.fmt(loop.start) + " → " + SSP.time.fmt(loop.end));
  }

  function fullscreen() {
    const stage = $("#videoStage");
    document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen?.();
  }

  function screenshot() {
    if (!video.videoWidth) { SSP.toast(SSP.i18n.t("video_error"), "err"); return; }
    const c = document.createElement("canvas");
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0);
    try { c.getContext("2d").getImageData(0, 0, 1, 1); }   // throws if canvas is tainted (no-CORS URL)
    catch (_) { SSP.toast(SSP.i18n.t("cors_note"), "err", 5000); return; }
    try {
      c.toBlob(blob => {
        const name = `frame_${SSP.time.fmt(video.currentTime).replace(/[:.]/g, "-")}.png`;
        SSP.download(name, blob, "image/png");
      }, "image/png");
    } catch (e) {
      SSP.toast("Screenshot blocked by CORS for this video URL", "err");
    }
  }

  /* ---------------- Live overlay ---------------- */
  let overlayId = null;
  function renderOverlay() {
    const s = SSP.model.atTime(video.currentTime);
    const id = s ? s.id : null;
    const st = SSP.settings.get().style;
    if (id !== overlayId || s) {
      overlayId = id;
      overlayText.textContent = s ? s.text : "";
      overlayText.style.display = s && s.text ? "" : "none";
    }
    overlay.className = "";
    overlay.id = "subOverlay";
    if (st.position === "top") overlay.classList.add("pos-top");
    if (st.position === "middle") overlay.classList.add("pos-middle");
    const px = Math.round(st.size * ($("#videoStage").clientHeight / 480));
    overlayText.style.fontSize = Math.max(10, px) + "px";
    overlayText.style.fontFamily = st.font;
    overlayText.style.color = st.color;
    overlayText.style.opacity = st.opacity;
    overlayText.style.background = st.bg ? `rgba(0,0,0,${st.bgOpacity})` : "transparent";
    overlayText.style.textShadow = [
      st.outline ? `-1px -1px 0 ${st.outlineColor}, 1px -1px 0 ${st.outlineColor}, -1px 1px 0 ${st.outlineColor}, 1px 1px 0 ${st.outlineColor}` : "",
      st.shadow ? `2px 2px 6px rgba(0,0,0,.85)` : ""
    ].filter(Boolean).join(", ");
  }

  /* ---------------- Time loop ---------------- */
  function tick() {
    rafId = requestAnimationFrame(tick);
    if (!video.src) return;
    const t = video.currentTime, d = video.duration || 0;
    timecode.innerHTML = `${SSP.time.fmt(t)} <span class="dur">/ ${SSP.time.fmt(d)}</span>`;
    if (d && !seekbar.matches(":active")) seekbar.value = (t / d) * 1000;
    if (loop && t >= loop.end) video.currentTime = loop.start;
    renderOverlay();
    SSP.bus.emit("player:time", t);
  }

  /* ---------------- Init ---------------- */
  function init() {
    video = $("#video"); seekbar = $("#seekbar"); timecode = $("#timecode");
    overlay = $("#subOverlay"); overlayText = $("#subOverlayText");

    video.addEventListener("loadedmetadata", () => {
      SSP.bus.emit("video:ready", { duration: video.duration, name: currentFile?.name || currentURL });
      // Estimate FPS via requestVideoFrameCallback when available
      if (video.requestVideoFrameCallback) {
        let last = null, samples = [];
        const probe = (_, meta) => {
          if (last != null) samples.push(meta.mediaTime - last);
          last = meta.mediaTime;
          if (samples.length < 10) video.requestVideoFrameCallback(probe);
          else {
            const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
            if (avg > 0.001) fps = Math.round(1 / avg);
          }
        };
        video.requestVideoFrameCallback(probe);
      }
      if (currentFile) SSP.waveform.build(currentFile, video.duration);
      else if (currentURL) SSP.waveform.buildFromURL(currentURL, video.duration);
    });

    video.addEventListener("error", () => {
      if (!video.src) return;
      if (currentURL && video.crossOrigin === "anonymous" && !corsRetried) {
        // Server refused the CORS request → retry plain. Playback will work,
        // but pixel/audio access (waveform, screenshots, auto subs) won't.
        corsRetried = true;
        video.removeAttribute("crossorigin");
        video.src = currentURL;
        SSP.toast(SSP.i18n.t("cors_note"), "", 6000);
        return;
      }
      SSP.toast(SSP.i18n.t("video_error"), "err");
      offerFFmpeg();
    });

    video.addEventListener("play", () => SSP.bus.emit("player:playstate", true));
    video.addEventListener("pause", () => SSP.bus.emit("player:playstate", false));
    video.addEventListener("click", playPause);

    seekbar.addEventListener("input", () => {
      if (video.duration) video.currentTime = (seekbar.value / 1000) * video.duration;
    });

    /* Transport buttons */
    $("#btnPlay").addEventListener("click", playPause);
    $("#btnFrameBack").addEventListener("click", () => frameStep(-1));
    $("#btnFrameFwd").addEventListener("click", () => frameStep(1));
    $("#btnBack5").addEventListener("click", () => jump(-5));
    $("#btnFwd5").addEventListener("click", () => jump(5));
    $("#btnBack10").addEventListener("click", () => jump(-10));
    $("#btnFwd10").addEventListener("click", () => jump(10));
    $("#btnBack30").addEventListener("click", () => jump(-30));
    $("#btnFwd30").addEventListener("click", () => jump(30));
    $("#btnLoop").addEventListener("click", toggleLoopSelection);
    $("#btnFullscreen").addEventListener("click", fullscreen);
    $("#btnShot").addEventListener("click", screenshot);
    $("#speedSel").addEventListener("change", e => setSpeed(e.target.value));
    $("#btnMute").addEventListener("click", () => { video.muted = !video.muted; });
    $("#volume").addEventListener("input", e => { video.volume = +e.target.value; video.muted = false; });

    SSP.bus.on("player:playstate", playing => {
      $("#btnPlay").innerHTML = playing
        ? '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>'
        : '<svg viewBox="0 0 24 24"><polygon points="7,4 20,12 7,20"/></svg>';
    });

    tick();
  }

  return {
    init, loadFile, loadURL, playPause, seek, jump, frameStep, screenshot,
    fullscreen, toggleLoopSelection,
    get video() { return video; },
    get time() { return video ? video.currentTime : 0; },
    get duration() { return video && isFinite(video.duration) ? video.duration : 0; },
    get hasVideo() { return !!(video && video.src); },
    get fps() { return fps; },
    get sourceName() { return currentFile?.name || currentURL || null; },
    get source() { return { file: currentFile, url: currentURL }; }
  };
})();
