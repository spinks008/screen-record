# Screen Record

A Windows screen recorder that turns raw recordings into polished videos: automatic zoom on clicks,
a smooth re-rendered cursor, backgrounds with padding/rounded corners/shadow, webcam overlay,
keystroke overlays, and a timeline editor. Inspired by the feature set of Pane Studio.

## Develop

```sh
npm install
npm run fetch-ffmpeg   # downloads ffmpeg.exe/ffprobe.exe into resources/bin
npm run dev            # if launched from VS Code, unset ELECTRON_RUN_AS_NODE first
npm test               # engine unit tests
npm run typecheck
npm run dist           # builds release/Screen Record Setup <version>.exe
```

## How it works

| Part | Implementation |
|---|---|
| Screen capture | FFmpeg `gfxcapture` (Windows.Graphics.Capture) with the cursor **off**, cropped to display/window/area; `ddagrab` fallback. Hardware H.264 (NVENC → QSV → AMF → MF → x264). Each pause segment is a crash-safe MKV, concatenated into `screen.mp4` on stop. |
| Mic / system audio / webcam | Hidden renderer window using `getUserMedia` / `getDisplayMedia` loopback + `MediaRecorder`, streamed to disk. |
| Mouse & keyboard | `uiohook-napi` global hooks + `GetCursorInfo` (via `koffi`) for the cursor shape. Stored per project in `events.json`. |
| Editor | React + zustand/immer (undo/redo). `src/engine/` holds pure, tested logic: auto-zoom, cursor spring smoothing, camera, timeline mapping, keystrokes, layout. `compositor.ts` (PixiJS) renders a frame; preview and export share it. |
| Export | Mediabunny decodes frames exactly → compositor → WebCodecs H.264 → MP4 streamed to the main process, where FFmpeg mixes audio (offsets, cuts, speed) or makes a GIF. |

Projects are saved in `Videos\Screen Record\Projects\<id>\`; exports go to `Videos\Screen Record\` (changeable in Settings).

Shortcuts: `Ctrl+Shift+R` start/stop, `Ctrl+Shift+P` pause/resume. In the editor: `Space` play, `Z` add zoom, `C` add cut,
`Del` delete the selected segment, `←/→` step a frame (`Shift` steps 1 s), `Ctrl+Z` / `Ctrl+Y` undo/redo.
