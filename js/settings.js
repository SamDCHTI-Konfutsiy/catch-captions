/* Subtitle Studio Pro — settings.js
   Theme, language, autosave interval, live subtitle style, accessibility. */
"use strict";
SSP.settings = (() => {
  const $ = SSP.dom.$;

  const DEFAULTS = {
    theme: "dark",
    lang: "en",
    contrast: "normal",
    autosaveSec: 30,
    style: {
      font: "-apple-system, 'Segoe UI', Arial, sans-serif",
      size: 24,                       // px at 480p reference height, scaled to stage
      color: "#ffffff",
      outline: true, outlineColor: "#000000",
      shadow: true,
      bg: true, bgOpacity: 0.45,
      opacity: 1,
      position: "bottom"
    }
  };

  let cfg = deepMerge(structuredClone(DEFAULTS), SSP.db.settingsLoad());

  function deepMerge(base, over) {
    for (const k in over) {
      if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k]))
        base[k] = deepMerge(base[k] || {}, over[k]);
      else if (over[k] !== undefined) base[k] = over[k];
    }
    return base;
  }

  function save() { SSP.db.settingsSave(cfg); }

  function applyTheme() {
    document.documentElement.dataset.theme = cfg.theme;
    document.documentElement.dataset.contrast = cfg.contrast;
    SSP.bus.emit("theme:change", cfg.theme);
  }

  function toggleTheme() { cfg.theme = cfg.theme === "dark" ? "light" : "dark"; applyTheme(); save(); syncForm(); }

  /* ---------------- Settings modal ---------------- */
  function syncForm() {
    $("#setTheme").value = cfg.theme;
    $("#setLang").value = cfg.lang;
    $("#setContrast").checked = cfg.contrast === "high";
    $("#setAutosave").value = cfg.autosaveSec;
    const s = cfg.style;
    $("#stFont").value = s.font;
    $("#stSize").value = s.size;
    $("#stColor").value = s.color;
    $("#stOutline").checked = s.outline;
    $("#stShadow").checked = s.shadow;
    $("#stBg").checked = s.bg;
    $("#stBgOp").value = s.bgOpacity;
    $("#stOpacity").value = s.opacity;
    $("#stPos").value = s.position;
  }

  function readForm() {
    cfg.theme = $("#setTheme").value;
    cfg.contrast = $("#setContrast").checked ? "high" : "normal";
    cfg.autosaveSec = SSP.time.clamp(+$("#setAutosave").value || 30, 5, 600);
    if (cfg.lang !== $("#setLang").value) { cfg.lang = $("#setLang").value; SSP.i18n.setLang(cfg.lang); }
    const s = cfg.style;
    s.font = $("#stFont").value;
    s.size = SSP.time.clamp(+$("#stSize").value || 24, 10, 72);
    s.color = $("#stColor").value;
    s.outline = $("#stOutline").checked;
    s.shadow = $("#stShadow").checked;
    s.bg = $("#stBg").checked;
    s.bgOpacity = SSP.time.clamp(+$("#stBgOp").value, 0, 1);
    s.opacity = SSP.time.clamp(+$("#stOpacity").value, 0.2, 1);
    s.position = $("#stPos").value;
    applyTheme();
    save();
    SSP.bus.emit("settings:change", cfg);
  }

  const open = () => { syncForm(); $("#settingsModal").classList.remove("hidden"); };
  const close = () => $("#settingsModal").classList.add("hidden");

  function init() {
    applyTheme();
    SSP.i18n.setLang(cfg.lang);

    $("#btnSettings").addEventListener("click", open);
    $("#settingsClose").addEventListener("click", close);
    $("#settingsModal").addEventListener("click", e => { if (e.target.id === "settingsModal") close(); });
    $("#btnTheme").addEventListener("click", toggleTheme);

    // live-apply on every control change
    SSP.dom.$$("#settingsModal select, #settingsModal input").forEach(n =>
      n.addEventListener("change", readForm));
    $("#setAutosave").addEventListener("keydown", e => e.stopPropagation());
  }

  return {
    init, open, toggleTheme,
    get: () => cfg,
    merge(over) { cfg = deepMerge(cfg, over); applyTheme(); SSP.i18n.setLang(cfg.lang); save(); }
  };
})();
