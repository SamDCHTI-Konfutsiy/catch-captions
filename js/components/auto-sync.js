/* Catch Captions — components/auto-sync.js
   Avtomatik siljishni aniqlash (auto offset detection).

   Muammo: yuklangan yoki generatsiya qilingan SRT butun fayl bo'ylab bir xil
   miqdorda oldinga/orqaga surilgan bo'ladi. Har bir qatorni qo'lda tuzatish
   real emas.

   Yechim: audiodagi nutq faolligi (VAD) profili bilan subtitr qatorlarining
   joylashuvini o'zaro solishtirib (cross-correlation), eng yaxshi mos keluvchi
   siljishni topamiz va uni butun faylga bir marta qo'llaymiz.

   Waveform peaklari allaqachon xotirada bo'lgani uchun qo'shimcha dekodlash
   talab etilmaydi — aniqlash bir necha yuz millisekundda tugaydi. */
"use strict";
SSP.autoSync = (() => {
  const RES = 20;          // profil aniqligi: sekundiga 20 nuqta (50 ms)
  const MAX_LAG = 60;      // ±60 sekundgacha siljishni qidiramiz
  const MIN_SCORE = 0.25;  // bundan past moslikda natijaga ishonmaymiz

  /* ---------- 1. Audiodan nutq faolligi profilini qurish ---------- */
  /** Waveform peaklaridan energiya konvertini oladi.
      Qaytaradi: Float32Array yoki null (waveform hali tayyor bo'lmasa). */
  function speechEnvelope(duration) {
    if (!SSP.waveform || !SSP.waveform.hasData) return null;
    const n = Math.max(1, Math.round(duration * RES));
    const mins = new Float32Array(n), maxs = new Float32Array(n);
    if (!SSP.waveform.read(0, duration, n, mins, maxs)) return null;
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = Math.abs(maxs[i]) + Math.abs(mins[i]);
    return env;
  }

  /** Konvertni 0/1 nutq maskasiga aylantiradi.
      Chegara global maksimumdan emas, medianadan hisoblanadi — shovqinli
      yozuvlarda bu ancha barqaror ishlaydi. */
  function speechMask(env) {
    const sorted = Float32Array.from(env).sort();
    const median = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
    const thr = median + (p90 - median) * 0.35;
    const m = new Uint8Array(env.length);
    for (let i = 0; i < env.length; i++) m[i] = env[i] > thr ? 1 : 0;
    // qisqa uzilishlarni to'ldirish (nutq ichidagi pauzalar 250 ms gacha)
    const gap = Math.round(0.25 * RES);
    for (let i = 0; i < m.length; i++) {
      if (m[i]) continue;
      let j = i;
      while (j < m.length && !m[j]) j++;
      if (j - i <= gap && i > 0 && j < m.length) for (let k = i; k < j; k++) m[k] = 1;
      i = j;
    }
    return m;
  }

  /* ---------- 2. Subtitrlardan maska qurish ---------- */
  function cueMask(subs, n) {
    const m = new Uint8Array(n);
    for (const s of subs) {
      const a = Math.max(0, Math.floor(s.start * RES));
      const b = Math.min(n, Math.ceil(s.end * RES));
      for (let i = a; i < b; i++) m[i] = 1;
    }
    return m;
  }

  /* ---------- 3. Eng yaxshi siljishni topish ---------- */
  /** Jaccard o'xshashligi bo'yicha ±MAX_LAG oralig'ida qidiradi.
      Ikki bosqichli: avval 0,5 s qadam bilan qo'pol, so'ng 50 ms bilan aniq. */
  function search(speech, cue, coarseStep, center, span) {
    let best = center, bestScore = -1;
    for (let lag = center - span; lag <= center + span; lag += coarseStep) {
      let inter = 0, union = 0;
      for (let i = 0; i < cue.length; i++) {
        const j = i + lag;
        const a = cue[i];
        const b = (j >= 0 && j < speech.length) ? speech[j] : 0;
        if (a | b) { union++; if (a & b) inter++; }
      }
      const score = union ? inter / union : 0;
      if (score > bestScore) { bestScore = score; best = lag; }
    }
    return { lag: best, score: bestScore };
  }

  /** Asosiy funksiya. Qaytaradi: { offset, score } yoki null. */
  function detect(subs, duration) {
    if (!subs || subs.length < 3) return null;
    const env = speechEnvelope(duration);
    if (!env) return null;
    const speech = speechMask(env);
    const cue = cueMask(subs, env.length);

    const coarse = search(speech, cue, Math.round(0.5 * RES), 0, MAX_LAG * RES);
    const fine = search(speech, cue, 1, coarse.lag, Math.round(0.6 * RES));
    if (fine.score < MIN_SCORE) return { offset: fine.lag / RES, score: fine.score, weak: true };
    return { offset: fine.lag / RES, score: fine.score, weak: false };
  }

  /* ---------- 4. Qo'llash ---------- */
  function applyOffset(delta, subs) {
    const list = subs || SSP.model.all();
    if (!list.length || !isFinite(delta) || Math.abs(delta) < 0.001) return 0;
    SSP.model.batch(() => {
      for (const s of list) {
        const dur = s.end - s.start;
        const start = Math.max(0, s.start + delta);
        SSP.model.update(s.id, { start, end: start + dur }, { silent: true });
      }
    }, SSP.i18n.t("autosync_undo") || "Auto-sync");
    return list.length;
  }

  /** Tugma bosilganda: aniqlash → tasdiqlash → qo'llash. */
  async function runDetectAndApply() {
    const subs = SSP.model.all();
    const duration = SSP.player.duration || 0;
    if (subs.length < 3) { SSP.toast(SSP.i18n.t("autosync_need_cues") || "Kamida 3 ta qator kerak", "err", 3000); return; }
    if (!duration) { SSP.toast(SSP.i18n.t("asr_no_video") || "Avval video yuklang", "err", 3000); return; }
    if (!SSP.waveform.hasData) { SSP.toast(SSP.i18n.t("autosync_no_wave") || "Audio profili hali tayyor emas", "err", 3500); return; }

    const r = detect(subs, duration);
    if (!r) { SSP.toast(SSP.i18n.t("autosync_fail") || "Siljishni aniqlab bo'lmadi", "err", 3500); return; }

    const secs = r.offset.toFixed(2);
    const pct = Math.round(r.score * 100);
    if (Math.abs(r.offset) < 0.05) {
      SSP.toast((SSP.i18n.t("autosync_already") || "Subtitrlar allaqachon mos") + ` (${pct}%)`, "ok", 3000);
      return;
    }
    if (r.weak) {
      const ok = confirm(
        (SSP.i18n.t("autosync_weak") || "Moslik past") + ` (${pct}%).\n` +
        (SSP.i18n.t("autosync_ask") || "Taklif etilgan siljish") + `: ${secs > 0 ? "+" : ""}${secs} s.\n` +
        (SSP.i18n.t("autosync_apply_q") || "Baribir qo'llansinmi?")
      );
      if (!ok) return;
    }
    const n = applyOffset(r.offset, subs);
    SSP.toast(
      (SSP.i18n.t("autosync_done") || "Siljitildi") + `: ${secs > 0 ? "+" : ""}${secs} s · ${n} ` +
      (SSP.i18n.t("autosync_cues") || "qator") + ` · ${pct}%`,
      "ok", 4500
    );
  }

  function init() {
    const btn = SSP.dom.$("#btnAutoSync");
    if (btn) btn.addEventListener("click", runDetectAndApply);
    // Sinxronizatsiya panelidagi tugma ham shu funksiyani chaqirishi mumkin
    const btn2 = SSP.dom.$("#btnSyncAuto");
    if (btn2) btn2.addEventListener("click", runDetectAndApply);
  }

  return { init, detect, applyOffset, runDetectAndApply };
})();
