# Subtitle Studio Pro — Architecture

A complete offline subtitle editing application. No backend, no server, no build
step. Open `index.html` and everything works — Windows, macOS, Linux, GitHub
Pages, installable as a PWA when hosted.

## 1. Design decisions

| Decision | Why |
|---|---|
| Classic `<script>` tags, one `SSP` namespace | ES modules are blocked on `file://` by browser CORS rules. Classic scripts guarantee the app works by double-clicking `index.html`. |
| Hand-written CSS design tokens instead of Tailwind CDN | The Tailwind CDN script requires internet, which breaks the hard offline requirement. The token system in `styles/main.css` gives the same utility with zero network. |
| Canvas timeline with windowed rendering | DOM blocks die at ~5k cues. The canvas draws only the visible time window; the model answers "what's visible" via binary search in ~6µs, so 100,000 cues render at 60fps. |
| Command-based undo (op + inverse op) | Snapshot undo at 100k lines costs MBs per keystroke. Recording `{do, undo}` pairs makes undo/redo unlimited and O(1) memory per edit. |
| Virtualized subtitle list | Fixed 56px rows, a sizer element for scroll height, and a reused row pool: ~30 DOM nodes regardless of subtitle count. |
| IndexedDB for projects, LocalStorage for settings | Projects can be large (async, structured clone). Settings are tiny and needed synchronously at boot. |
| Waveform via Web Audio `decodeAudioData` → min/max peak pairs | Fully local. Peaks stored at 100 pairs/sec (40 for >30min), windowed reads for any zoom. Off-main-thread worker over http(s), chunked inline fallback on `file://`. |
| Simplified/Traditional Chinese conversion uses OpenCC's raw character-mapping data (STCharacters.txt/TSCharacters.txt, Apache-2.0), embedded at build time | Bundling the authoritative source data keeps the feature 100% offline (no CDN call, unlike FFmpeg/Whisper) and needs no runtime dependency. It's character-level, not phrase-aware like full OpenCC — accurate for the vast majority of text, with the tradeoff noted in-app. |
| Whisper in-browser (transformers.js) instead of WhisperX | WhisperX is a Python stack (faster-whisper + alignment models) — it cannot run in a no-backend HTML app. The same Whisper models compiled to ONNX run locally in the browser via transformers.js on WebGPU/WASM. 30 s windows give real progress + cancellation; timestamps are offset to absolute time; insertion is one undo step. Output hygiene: WebGPU runs an fp32 encoder + q4 decoder (q8-on-GPU corrupts output), near-silent windows are skipped (silence makes Whisper hallucinate), and a sanitizer drops repetition spam, 3+-script gibberish and impossible reading speeds, merges stacked duplicates, and keeps timestamps monotonic. |
| FFmpeg.wasm as *fallback*, loaded on demand | Bundling ~30MB of wasm would bloat the repo; most videos play natively. When the `<video>` element errors, the app offers a local FFmpeg conversion (one-time download of the converter; the *video never leaves the device*). |

## 2. Module graph

```
utils ─┬─ i18n ── (all UI text)
       ├─ parsers (SRT/VTT/ASS/SSA/SBV/TXT/JSON/CSV, parse+serialize)
       ├─ db (IndexedDB) ── project (multi-project, autosave, crash recovery)
       ├─ model (store, undo/redo, QC) ◄──── event bus ────► editor, timeline, search
       ├─ player (video, transport, overlay, screenshots, FFmpeg fallback)
       ├─ waveform (Web Audio peaks) ──► timeline (canvas)
       ├─ settings (theme, language, style)
       ├─ asr (in-browser Whisper transcription)
       ├─ exporter (downloads, backup/restore)
       ├─ shortcuts (global key map)
       └─ app (bootstrap, DnD, URL/YouTube, splitters, PWA)
```

Modules communicate only through `SSP.bus` events:
`model:change`, `model:select`, `model:softchange` (mid-drag), `player:time`,
`video:ready`, `waveform:ready`, `settings:change`, `theme:change`, `status`.

## 3. Data model

```js
Subtitle  { id: number, start: seconds, end: seconds, text: string }
           // kept sorted by (start, end, id) — binary insert on every mutation

Project   { id, name, createdAt, updatedAt, subtitles: Subtitle[], videoName }

Settings  { theme, lang, contrast, autosaveSec,
            style: { font, size, color, outline, outlineColor,
                     shadow, bg, bgOpacity, opacity, position } }

UndoStep  = [{ do: Op, undo: Op }, ...]   // one array = one user gesture
Op        = { type: "add", sub } | { type: "remove", id } | { type: "patch", id, fields }
```

## 4. UI wireframe

```
┌──────────────────────────────────────────────────────────────────┐
│ ⏺ SS  Subtitle Studio Pro  [project ▾] │ Open video · Open subs  │
│                        status · Save · 🔍 · ✓ · Export · ◐ · ⚙   │
├───────────────────────────────┬──────────────────────────────────┤
│                               │ EDITOR      #12                  │
│        VIDEO  (16:9)          │ [● capture strip  [ ]  buttons ] │
│    live subtitle overlay      │ Start 00:00:04.120  End  Dur     │
│                               │ ┌ text ───────────────────────┐  │
│ ──────── seekbar ───────────  │ └──────────────────────────── ┘  │
│ 00:00:04.120 / 01:32:00.000   │ 34 chars · 2 lines · 14.2 CPS    │
│ −30 −10 −5 ‹│ ▶ │› +5 +10 +30 │ [Add][Delete][Split][Merge][Dup] │
│ 1× ↻ 📷 🔊 ▭                  ├──────────────────────────────────┤
│                               │ SUBTITLES (312)   virtual list   │
│                               │ #  start  end  text        CPS   │
├───────────────────────────────┴──────────────────────────────────┤
│ TIMELINE   Follow · Fit · − 80px/s +                             │
│ ruler ─────────────────────────────────────────────────────────  │
│ waveform ▂▄▆█▆▄▂▁▂▄▆▄▂  ▲playhead                                │
│ blocks   [ Hello world ][ Second cue ]     [ drag / resize ]     │
└──────────────────────────────────────────────────────────────────┘
```

## 5. Keyboard shortcut map

| Key | Action | Key | Action |
|---|---|---|---|
| `Space` | Play / pause | `Ctrl+Z` / `Ctrl+Y` | Undo / redo (unlimited) |
| `[` | Mark subtitle start | `Ctrl+C` / `Ctrl+V` | Copy / paste cue |
| `]` | Mark end → creates cue, focuses editor | `Ctrl+D` | Duplicate cue |
| `Enter` (in editor) | Save cue, resume playback | `Ctrl+S` | Save project |
| `Shift+Enter` | New line inside cue | `Ctrl+F` | Search & replace |
| `Delete` | Remove selected cue | `S` / `M` | Split / merge |
| `←` / `→` | Frame step | `L` | Loop selected cue |
| `Shift+←/→` | ±5s | `F` | Fullscreen |
| `Ctrl+←/→` | ±10s | `+` / `−` | Timeline zoom |
| `Alt+←/→` | ±30s | `↑` / `↓` | Previous / next cue |
| `Esc` | Close dialogs | *Ctrl+wheel on timeline* | Zoom at cursor |

## 6. The subtitle creation workflow

1. Video plays. `Space` pauses any time.
2. Press `[` → start timestamp captured (capture strip turns amber).
3. Press `]` → cue created from `[`…`]`, cursor lands in the text box automatically.
4. Type. Press `Enter` → cue saved, playback resumes. Repeat.

Buttons "Set start [" / "Set end ]" mirror the keys for mouse-first users.
Double-clicking empty timeline space also creates a cue at that instant.

## 7. Quality checks

Reading speed (CPS > 21 error, > 17 warning), duration bounds (0.7s–7s),
line length (> 42 chars), > 2 lines, overlap detection, gap-too-small
detection (< 80ms). The report is clickable — each finding jumps the playhead
and selection to the offending cue. Text and structure are exposed via
`SSP.model.qc()` so an external grammar checker can be layered on the same API.

## 8. Storage & recovery

- Autosave on a settings-defined interval (default 30s), on tab hide, and on unload.
- A `dirtyFlag` in IndexedDB is set while edits are unsaved and cleared on clean
  exit — if it survives to the next boot, the last autosave is restored and the
  user is told their work was recovered.
- Backup = one JSON file (project + settings). Restore accepts it back on any machine.

## 9. Implementation roadmap (as built)

1. Tokens/theming + app shell → 2. parsers + round-trip tests →
3. model + undo + QC (headless-tested) → 4. player + overlay →
5. waveform → 6. canvas timeline interactions → 7. editor + virtual list →
8. search/replace/filters → 9. projects/autosave/recovery →
10. export/backup → 11. i18n ×4 → 12. shortcuts → 13. PWA/service worker →
14. static cross-checks (DOM ids, i18n keys) + performance passes.
