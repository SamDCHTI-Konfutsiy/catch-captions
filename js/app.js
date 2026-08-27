/* Subtitle Studio Pro — app.js
   Bootstrap: wiring, drag & drop, open video / subtitles / URL / YouTube,
   recent files, resizable panels, PWA registration. */
"use strict";
(() => {
  const $ = SSP.dom.$, el = SSP.dom.el;

  const VIDEO_EXT = ["mp4","mkv","avi","mov","m4v","flv","wmv","webm","mpeg","mpg","3gp","ts","mts","ogv","ogg"];
  const SUB_EXT = ["srt","vtt","ass","ssa","txt","sbv","json","csv"];

  /* ---------------- Opening files ---------------- */
  async function openAnyFile(file) {
    const ext = SSP.extname(file.name);
    if (SUB_EXT.includes(ext)) return openSubtitleFile(file);
    if (VIDEO_EXT.includes(ext) || (file.type || "").startsWith("video/")) return SSP.player.loadFile(file);
    // unknown: sniff by mime then try as subtitle text
    if ((file.type || "").startsWith("text/")) return openSubtitleFile(file);
    return SSP.player.loadFile(file);
  }

  async function openSubtitleFile(file) {
    try {
      const raw = await SSP.readText(file);
      const subs = SSP.parsers.detectAndParse(file.name, raw);
      if (!subs.length) throw new Error("No cues found");
      SSP.model.replaceAll(subs, `${SSP.i18n.t("imported")}: ${subs.length}`);
      await SSP.db.addRecent({ key: "s:" + file.name, kind: "subtitle", name: file.name });
      SSP.bus.emit("recents:changed");
    } catch (e) {
      SSP.toast("Import: " + e.message, "err", 4000);
    }
  }

  async function browseVideo() {
    // File System Access API → real reopenable recents; fallback to <input type=file>
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: "Video", accept: { "video/*": VIDEO_EXT.map(e => "." + e) } }]
        });
        const file = await handle.getFile();
        await SSP.db.addRecent({ key: "v:" + file.name, kind: "video", name: file.name, handle });
        SSP.bus.emit("recents:changed");
        SSP.player.loadFile(file);
        return;
      } catch (e) { if (e.name === "AbortError") return; }
    }
    const f = await SSP.pickFile("video/*," + VIDEO_EXT.map(e => "." + e).join(","));
    if (f) SSP.player.loadFile(f);
  }

  async function browseSubs() {
    const f = await SSP.pickFile(SUB_EXT.map(e => "." + e).join(","));
    if (f) openSubtitleFile(f);
  }

  /* ---------------- Drag & drop ---------------- */
  function initDnD() {
    const hint = $("#dropHint");
    let depth = 0;
    window.addEventListener("dragenter", e => { e.preventDefault(); depth++; hint.classList.add("over"); });
    window.addEventListener("dragleave", e => { e.preventDefault(); if (--depth <= 0) { depth = 0; hint.classList.remove("over"); } });
    window.addEventListener("dragover", e => e.preventDefault());
    window.addEventListener("drop", e => {
      e.preventDefault(); depth = 0; hint.classList.remove("over");
      const files = [...(e.dataTransfer?.files || [])];
      // load video first, then subtitles — dropping both together Just Works
      files.sort((a, b) => (SUB_EXT.includes(SSP.extname(a.name)) ? 1 : 0) - (SUB_EXT.includes(SSP.extname(b.name)) ? 1 : 0));
      files.forEach(openAnyFile);
    });
  }

  /* ---------------- URL / YouTube ---------------- */
  const isYouTube = u => /(?:youtube\.com\/watch|youtube\.com\/shorts|youtu\.be\/)/i.test(u);

  function initUrlModal() {
    const modal = $("#urlModal");
    $("#btnOpenUrl").addEventListener("click", () => { modal.classList.remove("hidden"); $("#urlInput").focus(); });
    $("#urlClose").addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", e => { if (e.target.id === "urlModal") modal.classList.add("hidden"); });
    $("#urlInput").addEventListener("keydown", e => e.stopPropagation());

    $("#urlInput").addEventListener("input", () => {
      $("#ytNote").classList.toggle("hidden", !isYouTube($("#urlInput").value));
    });

    $("#btnUrlLoad").addEventListener("click", () => {
      const url = $("#urlInput").value.trim();
      if (!url) return;
      if (isYouTube(url)) {
        window.open(url, "_blank", "noopener");
        SSP.toast(SSP.i18n.t("yt_detected"), "", 5000);
      } else {
        SSP.player.loadURL(url);
      }
      modal.classList.add("hidden");
    });
    $("#btnUrlTab").addEventListener("click", () => {
      const url = $("#urlInput").value.trim();
      if (url) window.open(url, "_blank", "noopener");
    });
  }

  /* ---------------- Recent files ---------------- */
  async function renderRecents() {
    const wrap = $("#recentList");
    if (!wrap) return;
    wrap.innerHTML = "";
    const items = await SSP.db.listRecents().catch(() => []);
    if (!items.length) { wrap.classList.add("hidden"); $("#recentTitle").classList.add("hidden"); return; }
    wrap.classList.remove("hidden"); $("#recentTitle").classList.remove("hidden");
    for (const it of items.slice(0, 6)) {
      wrap.append(el("button", {
        class: "btn outline", text: (it.kind === "url" ? "🌐 " : it.kind === "subtitle" ? "💬 " : "🎬 ") + it.name.slice(0, 40),
        onclick: async () => {
          if (it.kind === "url") return SSP.player.loadURL(it.url);
          if (it.handle) {
            try {
              if ((await it.handle.queryPermission({ mode: "read" })) !== "granted")
                await it.handle.requestPermission({ mode: "read" });
              const f = await it.handle.getFile();
              return it.kind === "subtitle" ? openSubtitleFile(f) : SSP.player.loadFile(f);
            } catch (e) { SSP.toast(e.message, "err"); return; }
          }
          // no stored handle → browsers can't reopen local paths silently; reprompt
          it.kind === "subtitle" ? browseSubs() : browseVideo();
        }
      }));
    }
  }

  /* ---------------- Resizable panels ---------------- */
  function initSplitters() {
    const vs = $("#vSplit"), left = $("#videoPane"), right = $("#sidePane");
    let dragV = null;
    vs.addEventListener("pointerdown", e => {
      dragV = { x: e.clientX, lw: left.getBoundingClientRect().width };
      vs.setPointerCapture(e.pointerId); vs.classList.add("active");
    });
    vs.addEventListener("pointermove", e => {
      if (!dragV) return;
      const total = $("#workspace").clientWidth;
      const w = SSP.time.clamp(dragV.lw + (e.clientX - dragV.x), 320, total - 300);
      left.style.flex = `0 0 ${w}px`;
      right.style.flex = "1 1 auto";
    });
    vs.addEventListener("pointerup", () => { dragV = null; vs.classList.remove("active"); });

    const hs = $("#hSplit"), tl = $("#timelinePane");
    let dragH = null;
    hs.addEventListener("pointerdown", e => {
      dragH = { y: e.clientY, h: tl.getBoundingClientRect().height };
      hs.setPointerCapture(e.pointerId); hs.classList.add("active");
    });
    hs.addEventListener("pointermove", e => {
      if (!dragH) return;
      tl.style.height = SSP.time.clamp(dragH.h - (e.clientY - dragH.y), 120, window.innerHeight * 0.6) + "px";
    });
    hs.addEventListener("pointerup", () => { dragH = null; hs.classList.remove("active"); });
  }

  /* ---------------- Status line ---------------- */
  function initStatus() {
    SSP.bus.on("status", msg => { $("#statusLine").textContent = msg || ""; });
    SSP.bus.on("video:ready", info => {
      $("#dropHint").classList.add("hidden");
      SSP.bus.emit("status", "");
    });
  }

  /* ---------------- PWA ---------------- */
  function initPWA() {
    if (location.protocol.startsWith("http") && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW:", e));
    }
  }

  /* ---------------- Boot ---------------- */
  window.addEventListener("DOMContentLoaded", async () => {
    SSP.settings.init();      // theme + language first (before any i18n reads)
    SSP.i18n.apply();
    SSP.player.init();
    SSP.timeline.init();
    SSP.editor.init();
    SSP.search.init();
    SSP.hanziTool.init();
    SSP.syncTool.init();
    SSP.exporter.init();
    SSP.asr.init();
    SSP.shortcuts.init();
    SSP.project.init();
    SSP.autoSync.init();
    initDnD();
    initUrlModal();
    initSplitters();
    initStatus();
    initPWA();
    $("#btnOpenVideo").addEventListener("click", browseVideo);
    $("#btnOpenVideo2").addEventListener("click", browseVideo);
    $("#btnOpenSubs").addEventListener("click", browseSubs);
    $("#btnNewSubs").addEventListener("click", () => {
      if (!SSP.model.count() || confirm(SSP.i18n.t("new_subs") + "?")) SSP.model.replaceAll([], null);
    });
    SSP.bus.on("recents:changed", renderRecents);

    await SSP.project.boot();
    renderRecents();
  });
})();
