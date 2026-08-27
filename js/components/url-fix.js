/* Catch Captions — components/url-fix.js
   URL oynasining xatti-harakatini tuzatadi.

   MUAMMO: "Load URL" tugmasi YouTube havolasini aniqlasa, videoni yuklash
   o'rniga yangi tab ochib yuborardi. Foydalanuvchi uchun bu tushunarsiz —
   tugma "yuklash" deb yozilgan, lekin butunlay boshqa ish qiladi.

   YECHIM:
     1. Tugma endi HECH QACHON jimgina yangi tab ochmaydi.
     2. Havola turi oldindan aniqlanadi va foydalanuvchiga tushuntiriladi.
     3. To'g'ridan-to'g'ri media fayl bo'lmasa, tugma bloklanadi va sabab
        ko'rsatiladi — "Open in new tab" alohida, ochiq tanlov bo'lib qoladi.

   Bu fayl app.js ni tahrirlashni talab qilmaydi: eski tinglovchilarni
   tugmalarni klonlash orqali olib tashlaydi va yangilarini ulaydi.
   index.html da app.js dan KEYIN ulang. */
"use strict";
SSP.urlFix = (() => {
  const $ = SSP.dom.$;

  /* Brauzerning <video> elementi to'g'ridan-to'g'ri o'ynata oladigan fayllar */
  const DIRECT_MEDIA = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|avi|flv|ts|mts|mp3|m4a|wav|aac|flac|opus|oga)(\?|#|$)/i;
  /* Oqim manifestlari — faqat Safari da tabiiy ishlaydi */
  const STREAM_MANIFEST = /\.(m3u8|mpd)(\?|#|$)/i;
  /* Video sahifasi (fayl emas, HTML sahifa) beradigan xizmatlar */
  const VIDEO_PAGES = [
    { re: /(?:youtube\.com\/(?:watch|shorts|live)|youtu\.be\/)/i, name: "YouTube" },
    { re: /(?:vimeo\.com\/\d+)/i, name: "Vimeo" },
    { re: /(?:dailymotion\.com\/video)/i, name: "Dailymotion" },
    { re: /(?:facebook\.com\/.*\/videos|fb\.watch)/i, name: "Facebook" },
    { re: /instagram\.com\/(?:p|reel|tv)\//i, name: "Instagram" },
    { re: /(?:tiktok\.com\/@[^/]+\/video)/i, name: "TikTok" },
    { re: /(?:drive\.google\.com\/file)/i, name: "Google Drive" },
  ];

  /** Havola turini aniqlaydi: "media" | "manifest" | "page" | "unknown" */
  function classify(url) {
    let u;
    try { u = new URL(url); } catch { return { kind: "invalid" }; }
    if (!/^https?:$/.test(u.protocol)) return { kind: "invalid" };
    for (const p of VIDEO_PAGES) if (p.re.test(url)) return { kind: "page", service: p.name };
    if (DIRECT_MEDIA.test(u.pathname)) return { kind: "media" };
    if (STREAM_MANIFEST.test(u.pathname)) return { kind: "manifest" };
    return { kind: "unknown" };
  }

  /** Serverdan Content-Type ni so'rab ko'radi. CORS to'sib qo'ysa — null.
      Bu shunchaki qo'shimcha ma'lumot, qaror uchun majburiy emas. */
  async function probe(url) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(url, { method: "HEAD", signal: ctrl.signal, mode: "cors" });
      clearTimeout(timer);
      if (!r.ok) return { ok: false, status: r.status };
      return { ok: true, type: r.headers.get("content-type") || "" };
    } catch { return null; }   // CORS yoki tarmoq — bilib bo'lmadi
  }

  /* ---------------- UI ---------------- */
  const T = k => (SSP.i18n && SSP.i18n.t ? SSP.i18n.t(k) : "");

  function setNote(html, tone) {
    const el = $("#urlNote");
    if (!el) return;
    el.innerHTML = html;
    el.className = "hint" + (tone ? " " + tone : "");
    el.classList.toggle("hidden", !html);
  }

  /** Kiritilgan matnga qarab oynani yangilaydi. */
  function refresh() {
    const url = $("#urlInput").value.trim();
    const loadBtn = $("#btnUrlLoad");
    const tabBtn = $("#btnUrlTab");
    const ytNote = $("#ytNote");
    if (ytNote) ytNote.classList.add("hidden");   // eski xabarni o'chiramiz

    if (!url) { loadBtn.disabled = true; if (tabBtn) tabBtn.disabled = true; setNote(""); return; }
    if (tabBtn) tabBtn.disabled = false;

    const c = classify(url);
    if (c.kind === "invalid") {
      loadBtn.disabled = true;
      setNote(T("urlfix_invalid") || "Havola noto‘g‘ri. http:// yoki https:// bilan boshlanishi kerak.", "err");
      return;
    }
    if (c.kind === "page") {
      loadBtn.disabled = true;
      setNote(
        (T("urlfix_page_1") || `Bu — ${c.service} sahifasining havolasi, video fayl emas.`).replace("{s}", c.service) +
        "<br>" +
        (T("urlfix_page_2") || "Brauzerning video elementi faqat to‘g‘ridan-to‘g‘ri media faylni (.mp4, .webm, .mkv …) o‘ynata oladi. " +
         "Videoni avval qurilmangizga yuklab oling va “Open file” orqali oching."),
        "err"
      );
      return;
    }
    if (c.kind === "manifest") {
      loadBtn.disabled = false;
      setNote(T("urlfix_manifest") || "HLS/DASH oqimi. Tabiiy ravishda faqat Safari da ochiladi; boshqa brauzerlarda ishlamasligi mumkin.", "warn");
      return;
    }
    if (c.kind === "unknown") {
      loadBtn.disabled = false;
      setNote(T("urlfix_unknown") || "Havolada fayl kengaytmasi ko‘rinmadi. Yuklab ko‘rish mumkin, ammo bu media fayl bo‘lmasligi ehtimoli bor.", "warn");
      return;
    }
    loadBtn.disabled = false;
    setNote(T("urlfix_ok") || "To‘g‘ridan-to‘g‘ri media fayl. Yuklashga tayyor.", "ok");
  }

  /** Yuklash: endi hech qanday yashirin tab ochilmaydi. */
  async function doLoad() {
    const url = $("#urlInput").value.trim();
    if (!url) return;
    const c = classify(url);
    if (c.kind === "invalid" || c.kind === "page") { refresh(); return; }

    setNote(T("urlfix_checking") || "Havola tekshirilmoqda…", "");
    const info = await probe(url);

    if (info && info.ok === false) {
      setNote((T("urlfix_http") || "Server javobi: HTTP ") + info.status, "err");
      return;
    }
    if (info && info.ok && info.type && /^text\/html/i.test(info.type)) {
      setNote(
        T("urlfix_html") || "Server media fayl emas, HTML sahifa qaytardi. Bu havolani video sifatida ochib bo‘lmaydi.",
        "err"
      );
      return;
    }

    SSP.player.loadURL(url);
    $("#urlModal").classList.add("hidden");
    setNote("");
  }

  /** Eski tinglovchilarni tugunni klonlash orqali olib tashlaydi. */
  function strip(sel) {
    const el = $(sel);
    if (!el) return null;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    return clone;
  }

  function init() {
    if (!$("#urlModal")) return;

    /* Xabar uchun joy — agar hali bo'lmasa, o'zimiz qo'shamiz */
    if (!$("#urlNote")) {
      const anchor = $("#ytNote") || $("#urlInput").parentNode;
      const p = document.createElement("p");
      p.id = "urlNote";
      p.className = "hint hidden";
      anchor.parentNode.insertBefore(p, anchor.nextSibling);
    }

    const loadBtn = strip("#btnUrlLoad");
    const tabBtn = strip("#btnUrlTab");
    const input = strip("#urlInput");

    input.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Enter" && !loadBtn.disabled) doLoad();
    });
    input.addEventListener("input", refresh);
    input.addEventListener("paste", () => setTimeout(refresh, 0));

    loadBtn.addEventListener("click", doLoad);
    if (tabBtn) tabBtn.addEventListener("click", () => {
      const url = $("#urlInput").value.trim();
      if (url) window.open(url, "_blank", "noopener");
    });

    /* Oyna ochilganda holatni tozalab qo'yamiz */
    const openBtn = $("#btnOpenUrl");
    if (openBtn) openBtn.addEventListener("click", () => setTimeout(refresh, 0));

    refresh();
    console.info("[url-fix] Yuklandi: Load tugmasi endi yangi tab ochmaydi.");
  }

  return { init, classify, refresh };
})();
