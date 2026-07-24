# Subtitle Studio Pro

Professional **offline** subtitle editor that runs entirely in your browser.
No server, no install, no account. Your video and subtitles never leave your device.

## Run it

**Option A — just open it**
Download/unzip, then double-click `index.html`. Done.

**Option B — host it (enables PWA install + waveform worker)**
Serve the folder with any static host (GitHub Pages works as-is), open the URL,
then "Install app" from the browser menu for a desktop-app experience with
offline caching via the service worker.

## Features

- **Video**: MP4, WebM, MOV, MKV, AVI, OGV and anything your browser decodes.
  If a codec isn't supported, the app offers a *local* FFmpeg.wasm conversion
  (the converter itself downloads once; your video is never uploaded).
- **Video sources**: local files, drag & drop, direct video URLs, recent files
  (with one-click reopen in Chromium browsers via the File System Access API).
  YouTube pages can't be embedded by policy — the app explains this and lets you
  edit subtitles side-by-side with a YouTube tab.
- **Auto subtitles (AI)**: Whisper speech recognition running **inside the
  browser** (transformers.js, WebGPU with WASM fallback). Pick Tiny/Base/Small,
  choose a language or auto-detect, watch live progress, cancel any time and
  keep what's done. The model downloads once and is cached; **audio never
  leaves your device**. The result lands as regular cues — edit, QC, export.
  (Want WhisperX's word-level alignment/diarization? Run WhisperX on your
  machine and import its SRT/VTT here — the workflows compose.)
- **Simplified ↔ Traditional Chinese**: detects lines that mix 简体/繁體
  (common in ASR output) and converts the whole file to one consistently —
  fully offline using OpenCC's character data, one click, one undo step.
- **Subtitles**: open/save/import/export **SRT · VTT · ASS · SSA · SBV · TXT · JSON · CSV**.
- **Timeline**: zoomable canvas with waveform, draggable/resizable cue blocks,
  split, merge, duplicate, copy/paste, click-to-seek, playhead follow.
- **Fast capture workflow**: `[` marks start, `]` marks end and drops you into
  the text box, `Enter` saves and resumes playback.
- **Player**: frame stepping, ±5/10/30s jumps, 0.25×–2× speed, loop selected
  cue, fullscreen, volume/mute, PNG frame screenshots.
- **Live preview**: styled subtitle overlay (font, size, color, outline,
  shadow, background, opacity, position) rendered exactly over the video.
- **Search**: find/replace (regex optional), duplicate finder, empty finder,
  too-long finder.
- **Quality check**: CPS/reading speed, duration bounds, line length, overlap
  and gap detection — every finding is clickable.
- **Projects**: multiple projects, autosave, crash recovery, backup/restore as
  a single JSON file. Everything stored locally in IndexedDB.
- **Unlimited undo/redo**, virtualized rendering — smooth with 100,000 cues.
- **4 languages** (English, 中文, Русский, Oʻzbekcha), dark/light themes,
  high-contrast mode, keyboard-first design, screen-reader labels.

## Keyboard shortcuts

Open **Settings → Keyboard shortcuts** in the app, or see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full map.

## Notes on the offline promise

- Everything in this repo works with zero network from `file://`.
- Two optional features touch the network *once*, by explicit user action:
  the FFmpeg.wasm converter download, and loading a remote video URL you paste.
- The service worker (offline cache / PWA) activates only when hosted over
  http(s) — browsers do not allow service workers on `file://`, where the app
  is already offline by nature.

## Project structure

```
index.html            app shell
styles/main.css       design tokens, dark/light themes, all styles
assets/icon.svg       app icon
sw.js                 service worker (PWA cache when hosted)
manifest.webmanifest  PWA manifest
js/
  utils/utils.js      event bus, time & DOM helpers, downloads
  i18n.js             EN / ZH / RU / UZ
  parser/parsers.js   SRT VTT ASS SSA SBV TXT JSON CSV (parse + serialize)
  storage/db.js       IndexedDB layer
  storage/project.js  projects, autosave, crash recovery
  subtitle/model.js   sorted store, unlimited undo/redo, quality checks
  subtitle/editor.js  editor form, capture workflow, virtualized list
  player/player.js    video, transport, overlay, screenshots, FFmpeg fallback
  timeline/waveform.js  Web Audio peak generation
  timeline/timeline.js  canvas timeline (zoom/drag/resize/seek)
  components/search.js  find/replace/filters + QC report
  export/export.js    subtitle export, backup/restore
  settings.js         theme, language, style, autosave interval
  shortcuts.js        global key map
  workers/peaks-worker.js  off-thread waveform peaks (http(s) only)
docs/ARCHITECTURE.md  full architecture, data model, wireframes, roadmap
```
