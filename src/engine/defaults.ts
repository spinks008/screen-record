// Default style, background presets, and the smart defaults applied to a new recording.
import type { EditState, InputEvent, Style } from '@shared/types'
import { generateAutoZooms } from './autoZoom'

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

export function defaultStyle(): Style {
  return {
    background: { kind: 'gradient', value: 'aurora', blur: 0 },
    padding: 0.08,
    radius: 14,
    shadow: 0.6,
    aspect: 'auto',
    crop: { x: 0, y: 0, width: 1, height: 1 },
    motionBlur: 0.4,
    cursor: {
      visible: true,
      size: 1.6,
      smoothing: 'fast',
      hideIdle: true,
      idleMs: 2500,
      clickEffect: true,
      loopToStart: false
    },
    camera: { visible: true, shape: 'circle', size: 0.22, corner: 'bottom-right', mirror: true },
    keys: { enabled: true, mode: 'combos' },
    audio: { mic: { volume: 1, muted: false }, system: { volume: 0.8, muted: false } }
  }
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
