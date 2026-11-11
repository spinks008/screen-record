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

/** Width of the inset bezel in output pixels (0 when off). */
export function insetPx(style: Style, out: { width: number; height: number }): number {
  return style.inset.enabled ? Math.max(0, style.inset.width) * (Math.min(out.width, out.height) / 1080) : 0
}

/** Where the (cropped) screen content is drawn before zooming, in output pixels (inside the inset). */
export function screenRect(style: Style, src: { width: number; height: number }, out: { width: number; height: number }): Rect {
  const pad = style.padding * Math.min(out.width, out.height)
  const inset = insetPx(style, out)
  const availW = Math.max(2, out.width - pad * 2 - inset * 2)
  const availH = Math.max(2, out.height - pad * 2 - inset * 2)
  const c = croppedSize(style, src)
  const s = Math.min(availW / c.width, availH / c.height)
  const w = c.width * s
  const h = c.height * s
  return { x: (out.width - w) / 2, y: (out.height - h) / 2, width: w, height: h }
}

/** The card behind the screen: the screen rect grown by the inset. Its shadow and corners are drawn here. */
export function cardRect(style: Style, screen: Rect, out: { width: number; height: number }): Rect {
  const i = insetPx(style, out)
  return { x: screen.x - i, y: screen.y - i, width: screen.width + i * 2, height: screen.height + i * 2 }
}

export interface SceneTransform {
  scale: number
  /** Translation applied after scaling (output px). */
  tx: number
  ty: number
}

/**
 * Scene transform for a viewport: zoom so the focus point sits at the center of the frame.
 * The camera track already keeps the view inside the screen, so no clamping happens here.
 */
export function sceneTransform(vp: Viewport, screen: Rect, out: { width: number; height: number }): SceneTransform {
  const s = vp.scale
  const cx = screen.x + vp.fx * screen.width
  const cy = screen.y + vp.fy * screen.height
  return { scale: s, tx: out.width / 2 - cx * s, ty: out.height / 2 - cy * s }
}

/** Maps a point in source-video pixels to output pixels before the scene transform. */
export function sourceToScreen(style: Style, src: { width: number; height: number }, screen: Rect, x: number, y: number): { x: number; y: number } {
  const nx = (x / src.width - style.crop.x) / style.crop.width
  const ny = (y / src.height - style.crop.y) / style.crop.height
  return { x: screen.x + nx * screen.width, y: screen.y + ny * screen.height }
}

/** The webcam bubble. `size` is its longer side as a fraction of the output's shorter side. */
export function cameraRect(style: Style, out: { width: number; height: number }): Rect {
  const minSide = Math.min(out.width, out.height)
  const size = style.camera.size * minSide
  const aspect = style.camera.shape === 'circle' ? 1 : Math.min(3, Math.max(1 / 3, style.camera.aspect || 1))
  const width = aspect >= 1 ? size : size * aspect
  const height = aspect >= 1 ? size / aspect : size
  const margin = minSide * 0.035
  const corner: Corner = style.camera.corner
  const x = corner.endsWith('left') ? margin : out.width - width - margin
  const y = corner.startsWith('top') ? margin : out.height - height - margin
  return { x, y, width, height }
}
