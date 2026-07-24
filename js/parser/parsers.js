/* Subtitle Studio Pro — parser/parsers.js
   Parse + serialize: SRT, VTT, ASS, SSA, SBV, TXT, JSON, CSV.
   All parsers return [{start, end, text}] with seconds as floats. */
"use strict";
SSP.parsers = (() => {

  const norm = s => s.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");

  /* ---------------- SRT ---------------- */
  function parseSRT(raw) {
    const out = [];
    const blocks = norm(raw).split(/\n{2,}/);
    const TC = /(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;
    for (const b of blocks) {
      const lines = b.split("\n").filter(l => l.length);
      if (!lines.length) continue;
      let i = 0;
      if (/^\d+$/.test(lines[0].trim())) i = 1;            // optional index line
      const m = TC.exec(lines[i] || "");
      if (!m) continue;
      const t = n => +m[n];
      const start = t(1) * 3600 + t(2) * 60 + t(3) + t(4) / 1000;
      const end = t(5) * 3600 + t(6) * 60 + t(7) + t(8) / 1000;
      const text = lines.slice(i + 1).join("\n").trim();
      out.push({ start, end, text });
    }
    return out;
  }

  function toSRT(subs) {
    return subs.map((s, i) =>
      `${i + 1}\n${SSP.time.fmt(s.start, ",")} --> ${SSP.time.fmt(s.end, ",")}\n${s.text}\n`
    ).join("\n");
  }

  /* ---------------- WebVTT ---------------- */
  function parseVTT(raw) {
    const out = [];
    const body = norm(raw).replace(/^WEBVTT[^\n]*\n/, "");
    const TC = /((?:\d{1,2}:)?\d{1,2}:\d{1,2}\.\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{1,2}\.\d{1,3})/;
    for (const b of body.split(/\n{2,}/)) {
      const lines = b.split("\n").filter(l => l.trim().length);
      if (!lines.length) continue;
      if (/^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
      let i = 0;
      if (!TC.test(lines[0]) && lines[1] && TC.test(lines[1])) i = 1;  // cue id line
      const m = TC.exec(lines[i] || "");
      if (!m) continue;
      const start = SSP.time.parse(m[1]);
      const end = SSP.time.parse(m[2]);
      const text = lines.slice(i + 1).join("\n")
        .replace(/<\/?(c|v|b|i|u|lang|ruby|rt)[^>]*>/gi, "").trim();
      out.push({ start, end, text });
    }
    return out;
  }

  function toVTT(subs) {
    return "WEBVTT\n\n" + subs.map((s, i) =>
      `${i + 1}\n${SSP.time.fmt(s.start)} --> ${SSP.time.fmt(s.end)}\n${s.text}\n`
    ).join("\n");
  }

  /* ---------------- ASS / SSA ---------------- */
  function parseASS(raw) {
    const out = [];
    const lines = norm(raw).split("\n");
    let format = null, inEvents = false;
    for (const line of lines) {
      const l = line.trim();
      if (/^\[Events\]/i.test(l)) { inEvents = true; continue; }
      if (/^\[/.test(l)) { inEvents = false; continue; }
      if (!inEvents) continue;
      if (/^Format\s*:/i.test(l)) {
        format = l.slice(l.indexOf(":") + 1).split(",").map(s => s.trim().toLowerCase());
        continue;
      }
      const m = /^Dialogue\s*:\s*(.*)$/i.exec(l);
      if (!m) continue;
      const f = format || ["layer","start","end","style","name","marginl","marginr","marginv","effect","text"];
      const parts = m[1].split(",");
      const fixed = parts.slice(0, f.length - 1);
      fixed.push(parts.slice(f.length - 1).join(","));       // text may contain commas
      const rec = {};
      f.forEach((k, i) => rec[k] = (fixed[i] || "").trim());
      const start = SSP.time.parse(rec.start), end = SSP.time.parse(rec.end);
      if (!isFinite(start) || !isFinite(end)) continue;
      const text = (rec.text || "")
        .replace(/\{[^}]*\}/g, "")                           // strip override tags
        .replace(/\\N|\\n/g, "\n").replace(/\\h/g, " ").trim();
      out.push({ start, end, text });
    }
    return out;
  }

  function assTime(sec) {
    const cs = Math.round(sec * 100);
    const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60,
          s = Math.floor(cs / 100) % 60, c = cs % 100;
    const p = n => String(n).padStart(2, "0");
    return `${h}:${p(m)}:${p(s)}.${p(c)}`;
  }

  function toASS(subs, style = {}) {
    const st = Object.assign({ font: "Arial", size: 48, primary: "&H00FFFFFF", outline: "&H00000000" }, style);
    const head =
`[Script Info]
Title: Subtitle Studio Pro Export
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${st.font},${st.size},${st.primary},&H000000FF,${st.outline},&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,60,60,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    const body = subs.map(s =>
      `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,${s.text.replace(/\n/g, "\\N")}`
    ).join("\n");
    return head + body + "\n";
  }

  function toSSA(subs, style) { return toASS(subs, style).replace("v4.00+", "v4.00").replace("[V4+ Styles]", "[V4 Styles]"); }

  /* ---------------- SBV (YouTube) ---------------- */
  function parseSBV(raw) {
    const out = [];
    const TC = /(\d{1,2}):(\d{1,2}):(\d{1,2})\.(\d{1,3})\s*,\s*(\d{1,2}):(\d{1,2}):(\d{1,2})\.(\d{1,3})/;
    for (const b of norm(raw).split(/\n{2,}/)) {
      const lines = b.split("\n").filter(l => l.length);
      if (!lines.length) continue;
      const m = TC.exec(lines[0]);
      if (!m) continue;
      const t = n => +m[n];
      out.push({
        start: t(1) * 3600 + t(2) * 60 + t(3) + t(4) / 1000,
        end: t(5) * 3600 + t(6) * 60 + t(7) + t(8) / 1000,
        text: lines.slice(1).join("\n").trim()
      });
    }
    return out;
  }

  function toSBV(subs) {
    const f = s => { const t = SSP.time.fmt(s); return t.replace(/^0/, "").replace(/^(\d):/, "$1:"); };
    return subs.map(s => `${f(s.start)},${f(s.end)}\n${s.text}\n`).join("\n");
  }

  /* ---------------- Plain text ---------------- */
  function parseTXT(raw, gap = 0.5, dur = 3) {
    const lines = norm(raw).split("\n").map(l => l.trim()).filter(Boolean);
    let t = 0;
    return lines.map(text => { const s = { start: t, end: t + dur, text }; t += dur + gap; return s; });
  }
  const toTXT = subs => subs.map(s => s.text.replace(/\n/g, " ")).join("\n");

  /* ---------------- JSON ---------------- */
  function parseJSON(raw) {
    const data = JSON.parse(raw);
    const arr = Array.isArray(data) ? data : (data.subtitles || data.cues || data.events || []);
    return arr.map(o => ({
      start: typeof o.start === "string" ? SSP.time.parse(o.start) : +o.start,
      end: typeof o.end === "string" ? SSP.time.parse(o.end) : +o.end,
      text: String(o.text ?? o.content ?? "")
    })).filter(s => isFinite(s.start) && isFinite(s.end));
  }
  const toJSON = subs => JSON.stringify(subs.map((s, i) =>
    ({ index: i + 1, start: +s.start.toFixed(3), end: +s.end.toFixed(3), text: s.text })), null, 2);

  /* ---------------- CSV ---------------- */
  function csvSplit(line) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function parseCSV(raw) {
    const lines = norm(raw).split("\n").filter(l => l.trim());
    if (!lines.length) return [];
    let startAt = 0;
    const head = csvSplit(lines[0]).map(h => h.trim().toLowerCase());
    let iS = head.indexOf("start"), iE = head.indexOf("end"), iT = head.indexOf("text");
    if (iS >= 0 && iE >= 0 && iT >= 0) startAt = 1; else { iS = 0; iE = 1; iT = 2; }
    const out = [];
    for (let i = startAt; i < lines.length; i++) {
      const c = csvSplit(lines[i]);
      const start = SSP.time.parse(c[iS]) || parseFloat(c[iS]);
      const end = SSP.time.parse(c[iE]) || parseFloat(c[iE]);
      if (!isFinite(start) || !isFinite(end)) continue;
      out.push({ start, end, text: (c[iT] || "").replace(/\\n/g, "\n") });
    }
    return out;
  }

  const csvCell = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const toCSV = subs => "start,end,text\n" + subs.map(s =>
    `${SSP.time.fmt(s.start)},${SSP.time.fmt(s.end)},${csvCell(s.text.replace(/\n/g, "\\n"))}`).join("\n");

  /* ---------------- Dispatch ---------------- */
  function detectAndParse(name, raw) {
    const ext = SSP.extname(name);
    try {
      switch (ext) {
        case "srt": return parseSRT(raw);
        case "vtt": return parseVTT(raw);
        case "ass": case "ssa": return parseASS(raw);
        case "sbv": return parseSBV(raw);
        case "json": return parseJSON(raw);
        case "csv": return parseCSV(raw);
        case "txt": return parseTXT(raw);
      }
    } catch (e) { console.warn("parse by ext failed, sniffing:", e); }
    // Content sniffing fallback
    const head = raw.slice(0, 600);
    if (/^WEBVTT/m.test(head)) return parseVTT(raw);
    if (/\[Script Info\]/i.test(head)) return parseASS(raw);
    if (/-->/g.test(head)) return parseSRT(raw);
    if (/^\s*[\[{]/.test(head)) { try { return parseJSON(raw); } catch (_) {} }
    if (/\d:\d{2}:\d{2}\.\d{3}\s*,/.test(head)) return parseSBV(raw);
    return parseTXT(raw);
  }

  function serialize(fmt, subs, style) {
    switch (fmt) {
      case "srt": return toSRT(subs);
      case "vtt": return toVTT(subs);
      case "ass": return toASS(subs, style);
      case "ssa": return toSSA(subs, style);
      case "sbv": return toSBV(subs);
      case "txt": return toTXT(subs);
      case "json": return toJSON(subs);
      case "csv": return toCSV(subs);
      default: throw new Error("Unknown format: " + fmt);
    }
  }

  return { detectAndParse, serialize, parseSRT, parseVTT, parseASS, parseSBV, parseTXT, parseJSON, parseCSV };
})();
