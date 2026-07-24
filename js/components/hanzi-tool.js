/* Subtitle Studio Pro — components/hanzi-tool.js
   UI for Simplified <-> Traditional Chinese conversion + mixed-script detection. */
"use strict";
SSP.hanziTool = (() => {
  const $ = SSP.dom.$;

  function refresh() {
    const t = SSP.i18n.t;
    const subs = SSP.model.all();
    const a = SSP.hanzi.analyze(subs);
    $("#hanziStats").textContent = a.total
      ? t("hanzi_stats")
          .replace("{total}", a.total)
          .replace("{simp}", a.simpOnly)
          .replace("{trad}", a.tradOnly)
          .replace("{mixed}", a.mixedLines)
      : t("hanzi_empty");
    $("#hanziMixedNote").classList.toggle("hidden", a.mixedLines === 0);
  }

  function apply(target) {
    const subs = SSP.model.all();
    if (!subs.length) return;
    let changed = 0;
    SSP.model.batch(() => {
      for (const s of subs) {
        const out = SSP.hanzi.convert(s.text, target);
        if (out !== s.text) { SSP.model.update(s.id, { text: out }, { silent: true }); changed++; }
      }
    });
    SSP.toast(
      (target === "trad" ? SSP.i18n.t("hanzi_done_trad") : SSP.i18n.t("hanzi_done_simp"))
        .replace("{n}", changed),
      "ok", 3000
    );
    refresh();
  }

  const open = () => { refresh(); $("#hanziModal").classList.remove("hidden"); };
  const close = () => $("#hanziModal").classList.add("hidden");

  function init() {
    $("#btnHanzi").addEventListener("click", open);
    $("#hanziClose").addEventListener("click", close);
    $("#hanziModal").addEventListener("click", e => { if (e.target.id === "hanziModal") close(); });
    $("#btnHanziToSimp").addEventListener("click", () => apply("simp"));
    $("#btnHanziToTrad").addEventListener("click", () => apply("trad"));
    SSP.bus.on("model:change", () => { if (!$("#hanziModal").classList.contains("hidden")) refresh(); });
  }

  return { init };
})();
