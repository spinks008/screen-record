// Types shared by the main process, preload and renderer.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type SourceKind = 'display' | 'window' | 'area'

export interface DisplayInfo {
  id: number
  label: string
  /** Physical-pixel bounds on the virtual desktop. */
  bounds: Rect
  scaleFactor: number
  primary: boolean
  thumbnail?: string
}

export interface WindowInfo {
  hwnd: string
  title: string
  exe: string
  bounds: Rect
  thumbnail?: string
  icon?: string
}

export interface RecordingOptions {
  source:
    | { kind: 'display'; displayId: number }
    | { kind: 'window'; hwnd: string; title: string }
    | { kind: 'area'; displayId: number; rect: Rect }
  fps: 30 | 60
  micDeviceId: string | null
  systemAudio: boolean
  cameraDeviceId: string | null
  countdown: boolean
}

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'

export interface RecorderStatus {
  state: RecorderState
  /** Recorded (non-paused) milliseconds so far. */
  elapsedMs: number
  error?: string
}

export type CursorKind = 'arrow' | 'hand' | 'ibeam' | 'wait' | 'cross' | 'move' | 'ns' | 'ew' | 'nwse' | 'nesw' | 'no'

/** Input event in recording time (ms) and video pixel coordinates. */
export type InputEvent =
  | { type: 'move'; t: number; x: number; y: number; cursor?: CursorKind }
  | { type: 'down' | 'up'; t: number; x: number; y: number; button: 1 | 2 | 3 }
  | { type: 'wheel'; t: number; x: number; y: number; delta: number }
  | { type: 'key'; t: number; key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }

export type BackgroundKind = 'gradient' | 'color' | 'image' | 'wallpaper'

export interface Background {
  kind: BackgroundKind
  /** gradient: preset id; color: css color; image/wallpaper: media URL. */
  value: string
  blur: number
}

export type Aspect = 'auto' | '16:9' | '9:16' | '1:1' | '4:3' | '4:5'
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface Style {
  background: Background
  /** Padding as a fraction of the output's shorter side. */
  padding: number
  radius: number
  shadow: number
  aspect: Aspect
  /** Normalized crop of the source video. */
  crop: Rect
  motionBlur: number
  cursor: {
    visible: boolean
    size: number
    smoothing: 'off' | 'slow' | 'fast' | 'rapid'
    hideIdle: boolean
    idleMs: number
    clickEffect: boolean
    loopToStart: boolean
  }
  camera: {
    visible: boolean
    shape: 'circle' | 'rounded' | 'square'
    size: number
    corner: Corner
    mirror: boolean
  }
  keys: {
    enabled: boolean
    mode: 'combos' | 'all'
  }
  audio: {
    mic: { volume: number; muted: boolean }
    system: { volume: number; muted: boolean }
  }
}

export interface Segment {
  id: string
  /** Source (recording) time in ms. */
  start: number
  end: number
}

export interface ZoomSegment extends Segment {
  zoom: number
  /** follow: tracks the cursor, fixed: uses target. */
  mode: 'follow' | 'fixed'
  target: { x: number; y: number }
  auto: boolean
}

export interface SpeedSegment extends Segment {
  speed: number
}

export interface MaskSegment extends Segment {
  kind: 'blur' | 'highlight'
  /** Normalized to the source video. */
  rect: Rect
}

export interface CameraSegment extends Segment {
  layout: 'hidden' | 'fullscreen'
}

export interface EditState {
  trimStart: number
  trimEnd: number
  cuts: Segment[]
  speeds: SpeedSegment[]
  zooms: ZoomSegment[]
  masks: MaskSegment[]
  cameraSegments: CameraSegment[]
  style: Style
}

export interface Project {
  version: 1
  id: string
  name: string
  createdAt: number
  durationMs: number
  capture: {
    kind: SourceKind
    width: number
    height: number
    fps: number
    /** Physical desktop scale of the captured surface (for cursor sizing). */
    scaleFactor: number
  }
  files: {
    screen: string
    events: string
    camera?: string
    mic?: string
    system?: string
  }
  /** Screen time (ms) at which each track's time 0 occurs. */
  offsets: { camera: number; mic: number; system: number }
  edit: EditState
}

export interface ProjectSummary {
  id: string
  name: string
  createdAt: number
  durationMs: number
  thumbnail: string | null
}

export interface ExportOptions {
  format: 'mp4' | 'gif'
  height: 720 | 1080 | 1440 | 2160
  fps: 30 | 60
  quality: 'standard' | 'high' | 'max'
}

export interface Preset {
  id: string
  name: string
  style: Style
}

export interface Settings {
  fps: 30 | 60
  micDeviceId: string | null
  systemAudio: boolean
  cameraDeviceId: string | null
  countdown: boolean
  presets: Preset[]
  defaultPresetId: string | null
  exportFolder: string | null
}
