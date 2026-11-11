// Geometry of the composed frame: output size, where the screen sits, and the zoom transform.
import type { Aspect, Corner, Rect, Style } from '@shared/types'
import type { Viewport } from './camera'

const ASPECTS: Record<Exclude<Aspect, 'auto'>, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
  '4:5': 4 / 5
}

export function croppedSize(style: Style, src: { width: number; height: number }): { width: number; height: number } {
  return { width: src.width * style.crop.width, height: src.height * style.crop.height }
}

/** Output aspect ratio (width / height). */
export function outputAspect(style: Style, src: { width: number; height: number }): number {
  if (style.aspect !== 'auto') return ASPECTS[style.aspect]
  const c = croppedSize(style, src)
  return c.width / c.height
}

/** Output pixel size for a target height (the shorter side for portrait outputs). */
export function outputSize(style: Style, src: { width: number; height: number }, height: number): { width: number; height: number } {
  const ar = outputAspect(style, src)
  const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
  if (ar >= 1) return { width: even(height * ar), height: even(height) }
  return { width: even(height), height: even(height / ar) }
}

/** Where the (cropped) screen is drawn before zooming, in output pixels. */
export function screenRect(style: Style, src: { width: number; height: number }, out: { width: number; height: number }): Rect {
  const pad = style.padding * Math.min(out.width, out.height)
  const availW = out.width - pad * 2
  const availH = out.height - pad * 2
  const c = croppedSize(style, src)
  const s = Math.min(availW / c.width, availH / c.height)
  const w = c.width * s
  const h = c.height * s
  return { x: (out.width - w) / 2, y: (out.height - h) / 2, width: w, height: h }
}

export interface SceneTransform {
  scale: number
  /** Translation applied after scaling (output px). */
  tx: number
  ty: number
}

/**
 * Scene transform for a viewport: zoom about the focus point while keeping the
 * view inside the screen once zoomed far enough that the screen covers the frame.
 */
export function sceneTransform(vp: Viewport, screen: Rect, out: { width: number; height: number }): SceneTransform {
  const s = vp.scale
  const focusX = screen.x + vp.fx * screen.width
  const focusY = screen.y + vp.fy * screen.height
  let cx = out.width / 2 + (focusX - out.width / 2) * Math.min(1, vp.amount)
  let cy = out.height / 2 + (focusY - out.height / 2) * Math.min(1, vp.amount)
  const halfW = out.width / (2 * s)
  const halfH = out.height / (2 * s)
  // Zoomed in: keep the view inside the screen. Zoomed out (view wider than the screen):
  // keep the whole screen inside the view. Both bounds meet at the screen center, so motion stays continuous.
  const clamp = (v: number, a: number, b: number): number => Math.min(Math.max(a, b), Math.max(Math.min(a, b), v))
  cx = clamp(cx, screen.x + halfW, screen.x + screen.width - halfW)
  cy = clamp(cy, screen.y + halfH, screen.y + screen.height - halfH)
  return { scale: s, tx: out.width / 2 - cx * s, ty: out.height / 2 - cy * s }
}

/** Maps a point in source-video pixels to output pixels before the scene transform. */
export function sourceToScreen(style: Style, src: { width: number; height: number }, screen: Rect, x: number, y: number): { x: number; y: number } {
  const nx = (x / src.width - style.crop.x) / style.crop.width
  const ny = (y / src.height - style.crop.y) / style.crop.height
  return { x: screen.x + nx * screen.width, y: screen.y + ny * screen.height }
}

export function cameraRect(style: Style, out: { width: number; height: number }): Rect {
  const minSide = Math.min(out.width, out.height)
  const size = style.camera.size * minSide
  const margin = minSide * 0.035
  const corner: Corner = style.camera.corner
  const x = corner.endsWith('left') ? margin : out.width - size - margin
  const y = corner.startsWith('top') ? margin : out.height - size - margin
  return { x, y, width: size, height: size }
}
