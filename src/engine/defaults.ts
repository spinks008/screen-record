// Default style, background presets, and the smart defaults applied to a new recording.
import type { EditState, InputEvent, MotionPreset, Style } from '@shared/types'
import { generateAutoZooms } from './autoZoom'
import { CURSOR_PRESETS, SCREEN_PRESETS, motionFromPreset } from './spring'

export interface GradientPreset {
  id: string
  name: string
  angle: number
  stops: string[]
}

export const GRADIENTS: GradientPreset[] = [
  { id: 'aurora', name: 'Aurora', angle: 135, stops: ['#5b5bf7', '#a855f7', '#ec4899'] },
  { id: 'sunset', name: 'Sunset', angle: 135, stops: ['#f97316', '#ef4444', '#be185d'] },
  { id: 'ocean', name: 'Ocean', angle: 160, stops: ['#0ea5e9', '#2563eb', '#1e1b4b'] },
  { id: 'mint', name: 'Mint', angle: 135, stops: ['#34d399', '#06b6d4', '#3b82f6'] },
  { id: 'peach', name: 'Peach', angle: 120, stops: ['#fde68a', '#fca5a5', '#f472b6'] },
  { id: 'midnight', name: 'Midnight', angle: 160, stops: ['#1e293b', '#0f172a', '#020617'] },
  { id: 'forest', name: 'Forest', angle: 140, stops: ['#14532d', '#166534', '#65a30d'] },
  { id: 'candy', name: 'Candy', angle: 45, stops: ['#a78bfa', '#f0abfc', '#fbcfe8'] },
  { id: 'ember', name: 'Ember', angle: 200, stops: ['#7c2d12', '#ea580c', '#facc15'] },
  { id: 'steel', name: 'Steel', angle: 180, stops: ['#e2e8f0', '#94a3b8', '#475569'] },
  { id: 'bloom', name: 'Bloom', angle: 220, stops: ['#1d4ed8', '#60a5fa', '#e0f2fe'] },
  { id: 'grape', name: 'Grape', angle: 135, stops: ['#3b0764', '#7e22ce', '#c026d3'] }
]

export const SOLID_COLORS = ['#ffffff', '#f1f5f9', '#0b0b0f', '#1f2937', '#2563eb', '#16a34a', '#f59e0b', '#dc2626']

/**
 * Procedural "wallpapers": a dark or light base with large soft color blobs and flowing ribbons.
 * Rendered at any resolution by the compositor, so nothing is bundled or copied.
 */
export interface MeshPreset {
  id: string
  name: string
  base: string
  /** Blob centers (normalized), radius (fraction of the diagonal) and color. */
  blobs: { x: number; y: number; r: number; color: string }[]
  /** Ribbon colors swept across the frame; empty for a pure mesh. */
  ribbons: string[]
}

export const MESHES: MeshPreset[] = [
  { id: 'tide', name: 'Tide', base: '#030a2e', blobs: [{ x: 0.15, y: 0.2, r: 0.55, color: '#1d4ed8' }, { x: 0.85, y: 0.85, r: 0.5, color: '#0ea5e9' }, { x: 0.7, y: 0.15, r: 0.35, color: '#312e81' }], ribbons: ['#3b82f6', '#60a5fa', '#1e40af'] },
  { id: 'dusk', name: 'Dusk', base: '#12071f', blobs: [{ x: 0.2, y: 0.8, r: 0.55, color: '#f97316' }, { x: 0.8, y: 0.25, r: 0.5, color: '#7c3aed' }, { x: 0.55, y: 0.55, r: 0.3, color: '#db2777' }], ribbons: ['#fb923c', '#f472b6', '#a78bfa'] },
  { id: 'ember', name: 'Ember', base: '#140703', blobs: [{ x: 0.25, y: 0.3, r: 0.6, color: '#ea580c' }, { x: 0.85, y: 0.8, r: 0.5, color: '#facc15' }, { x: 0.75, y: 0.2, r: 0.3, color: '#b91c1c' }], ribbons: ['#f97316', '#fbbf24', '#dc2626'] },
  { id: 'lagoon', name: 'Lagoon', base: '#021a1a', blobs: [{ x: 0.2, y: 0.25, r: 0.5, color: '#0d9488' }, { x: 0.8, y: 0.75, r: 0.55, color: '#22d3ee' }, { x: 0.6, y: 0.3, r: 0.3, color: '#065f46' }], ribbons: ['#2dd4bf', '#67e8f9', '#0f766e'] },
  { id: 'orchid', name: 'Orchid', base: '#0f0820', blobs: [{ x: 0.3, y: 0.7, r: 0.55, color: '#9333ea' }, { x: 0.8, y: 0.2, r: 0.45, color: '#ec4899' }, { x: 0.1, y: 0.1, r: 0.3, color: '#4338ca' }], ribbons: ['#c084fc', '#f0abfc', '#818cf8'] },
  { id: 'graphite', name: 'Graphite', base: '#08090c', blobs: [{ x: 0.25, y: 0.25, r: 0.55, color: '#334155' }, { x: 0.8, y: 0.8, r: 0.5, color: '#1e293b' }, { x: 0.7, y: 0.3, r: 0.3, color: '#475569' }], ribbons: ['#64748b', '#94a3b8', '#334155'] },
  { id: 'sorbet', name: 'Sorbet', base: '#fde7e1', blobs: [{ x: 0.2, y: 0.3, r: 0.55, color: '#fda4af' }, { x: 0.85, y: 0.7, r: 0.5, color: '#fcd34d' }, { x: 0.6, y: 0.15, r: 0.35, color: '#c4b5fd' }], ribbons: [] },
  { id: 'glacier', name: 'Glacier', base: '#e6f0ff', blobs: [{ x: 0.2, y: 0.8, r: 0.5, color: '#93c5fd' }, { x: 0.85, y: 0.15, r: 0.45, color: '#a5f3fc' }, { x: 0.75, y: 0.85, r: 0.3, color: '#c7d2fe' }], ribbons: [] },
  { id: 'meadow', name: 'Meadow', base: '#04140a', blobs: [{ x: 0.2, y: 0.8, r: 0.55, color: '#16a34a' }, { x: 0.8, y: 0.2, r: 0.5, color: '#84cc16' }, { x: 0.6, y: 0.6, r: 0.3, color: '#0e7490' }], ribbons: ['#4ade80', '#a3e635', '#22c55e'] }
]

export function defaultStyle(): Style {
  return {
    background: { kind: 'mesh', value: 'tide', blur: 0 },
    padding: 0.08,
    radius: 14,
    shadow: { strength: 0.65, blur: 56, offsetY: 10 },
    inset: { enabled: false, width: 10, color: 'rgba(255,255,255,0.16)' },
    aspect: 'auto',
    crop: { x: 0, y: 0, width: 1, height: 1 },
    motion: {
      cursor: motionFromPreset(CURSOR_PRESETS, 'quick'),
      screen: motionFromPreset(SCREEN_PRESETS, 'quick')
    },
    motionBlur: { enabled: true, zoom: 0.4, pan: 0.4, cursor: 0.35, camera: 0.4 },
    cursor: {
      visible: true,
      size: 1.6,
      art: 'classic',
      alwaysArrow: false,
      typeHoldMs: 120,
      hideIdle: true,
      idleMs: 2000,
      clickEffect: 'ripple',
      clickSound: { enabled: false, volume: 0.6 },
      loopToStart: false
    },
    camera: { visible: true, shape: 'circle', size: 0.22, aspect: 1, corner: 'bottom-right', mirror: true },
    keys: { enabled: true, mode: 'combos' },
    audio: { mic: { volume: 1, muted: false }, system: { volume: 0.8, muted: false } }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Copies every value from `src` whose type matches the default's, recursing into objects. */
function mergeInto(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    const d = target[k]
    if (!(k in target)) continue
    if (isObject(d) && isObject(v)) mergeInto(d, v)
    else if (typeof d === typeof v && !isObject(d)) target[k] = v
  }
}

/**
 * Upgrades a saved style (any older version) to the current shape: missing fields get defaults,
 * old fields are mapped so existing projects and presets keep their look.
 */
export function normalizeStyle(raw: unknown): Style {
  const style = defaultStyle()
  if (!isObject(raw)) return style
  const r = structuredClone(raw) as Record<string, any>

  // v1: `shadow` was one strength with a fixed 40 px blur and 14 px offset.
  if (typeof r.shadow === 'number') r.shadow = { strength: r.shadow, blur: 40, offsetY: 14 }
  // v1: one motion blur amount for pans and zooms; no cursor/camera blur.
  if (typeof r.motionBlur === 'number') r.motionBlur = { enabled: r.motionBlur > 0, zoom: r.motionBlur, pan: r.motionBlur, cursor: 0, camera: 0 }
  if (isObject(r.cursor)) {
    // v1: smoothing presets; 'fast' is now called 'quick' (same spring).
    const smoothing = r.cursor.smoothing
    if (typeof smoothing === 'string' && !isObject(r.motion?.cursor)) {
      const preset = (smoothing === 'fast' ? 'quick' : smoothing) as MotionPreset | 'off'
      r.motion = { ...(isObject(r.motion) ? r.motion : {}), cursor: preset === 'off' ? { ...style.motion.cursor, preset: 'off' } : preset in CURSOR_PRESETS ? motionFromPreset(CURSOR_PRESETS, preset) : style.motion.cursor }
    }
    if (typeof r.cursor.clickEffect === 'boolean') r.cursor.clickEffect = r.cursor.clickEffect ? 'ripple' : 'none'
  }
  mergeInto(style as unknown as Record<string, unknown>, r)
  return style
}

export function createEdit(
  events: InputEvent[],
  durationMs: number,
  size: { width: number; height: number },
  style: Style = defaultStyle()
): EditState {
  return {
    trimStart: 0,
    trimEnd: durationMs,
    cuts: [],
    speeds: [],
    zooms: generateAutoZooms(events, durationMs, size),
    masks: [],
    cameraSegments: [],
    style
  }
}
