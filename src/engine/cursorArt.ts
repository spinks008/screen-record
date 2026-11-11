// Crisp vector cursors drawn to canvases (we never copy OS or third-party cursor bitmaps).
import type { CursorArtStyle, CursorKind } from '@shared/types'

export interface CursorArt {
  canvas: HTMLCanvasElement
  /** Hotspot as a fraction of the canvas size. */
  hx: number
  hy: number
}

const SIZE = 96

function make(draw: (c: CanvasRenderingContext2D) => void, hx: number, hy: number): CursorArt {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const c = canvas.getContext('2d')!
  c.scale(SIZE / 32, SIZE / 32)
  c.lineJoin = 'round'
  c.lineCap = 'round'
  c.shadowColor = 'rgba(0,0,0,0.35)'
  c.shadowBlur = 2.5
  c.shadowOffsetY = 1
  draw(c)
  return { canvas, hx: hx / 32, hy: hy / 32 }
}

/** Colors and outline for one cursor look. `fill` may be a gradient, built in the 32-unit drawing space. */
interface Palette {
  fill: (c: CanvasRenderingContext2D) => string | CanvasGradient
  stroke: string
  width: number
  /** Draws the pointer with the rounded modern shape instead of the classic one. */
  rounded: boolean
}

const PALETTES: Record<CursorArtStyle, Palette> = {
  classic: { fill: () => '#111', stroke: '#fff', width: 1.6, rounded: false },
  light: { fill: () => '#fff', stroke: '#111', width: 1.3, rounded: false },
  solid: { fill: () => '#0b0b0f', stroke: 'rgba(255,255,255,0.85)', width: 0.7, rounded: true },
  gradient: {
    fill: (c) => {
      const g = c.createLinearGradient(7, 4, 21, 27)
      g.addColorStop(0, '#60a5fa')
      g.addColorStop(0.55, '#8b5cf6')
      g.addColorStop(1, '#ec4899')
      return g
    },
    stroke: '#fff',
    width: 1.4,
    rounded: true
  }
}

function fillStroke(c: CanvasRenderingContext2D, p: Path2D, pal: Palette): void {
  c.lineWidth = pal.width * 2
  c.strokeStyle = pal.stroke
  c.stroke(p)
  c.shadowColor = 'transparent'
  c.fillStyle = pal.fill(c)
  c.fill(p)
}

/** Draws a line icon (I-beam, crosshair) as an outline under a dark core. */
function lineIcon(c: CanvasRenderingContext2D, p: Path2D, pal: Palette): void {
  const dark = pal.stroke === '#111'
  c.lineWidth = 4.5
  c.strokeStyle = dark ? '#111' : '#fff'
  c.stroke(p)
  c.shadowColor = 'transparent'
  c.lineWidth = 1.8
  c.strokeStyle = dark ? '#fff' : '#111'
  c.stroke(p)
}

const CLASSIC_ARROW = 'M6 3 L6 23 L11 18.5 L14.5 26 L17.5 24.6 L14.2 17.4 L20.5 17.4 Z'
const ROUNDED_ARROW =
  'M7 4.6C7 3.7 8 3.2 8.7 3.8L22.9 16C23.6 16.6 23.2 17.7 22.3 17.8L16.4 18.4L19.5 24.9C19.8 25.5 19.5 26.2 18.9 26.5L17.4 27.2C16.8 27.5 16.1 27.2 15.8 26.6L12.8 20.1L8.6 24.3C8 24.9 7 24.5 7 23.6Z'

const arrow = (pal: Palette): CursorArt =>
  pal.rounded ? make((c) => fillStroke(c, new Path2D(ROUNDED_ARROW), pal), 7.2, 4.2) : make((c) => fillStroke(c, new Path2D(CLASSIC_ARROW), pal), 6, 3)

const hand = (pal: Palette): CursorArt =>
  make(
    (c) =>
      fillStroke(
        c,
        new Path2D(
          'M12 4.5c0-1.2 2.8-1.2 2.8 0V13l.2-2.1c0-1.2 2.7-1.2 2.7 0v2.3l.2-1.6c0-1.2 2.6-1.2 2.6 0v2.2l.3-1c.2-1.1 2.5-.9 2.4.3l-.4 6.4c-.2 2.8-2 5.6-5.4 5.6h-2.6c-2.2 0-3.4-1-4.6-2.7l-3.6-5.4c-.7-1.1.9-2.5 2-1.4l1.4 1.5z'
        ),
        pal
      ),
    13.4,
    4
  )

const ibeam = (pal: Palette): CursorArt => make((c) => lineIcon(c, new Path2D('M12 5h3l1 1 1-1h3M16 6v20M12 27h3l1-1 1 1h3'), pal), 16, 16)

const cross = (pal: Palette): CursorArt => make((c) => lineIcon(c, new Path2D('M16 5v22M5 16h22'), pal), 16, 16)

const resize = (angle: number, pal: Palette): CursorArt =>
  make((c) => {
    c.translate(16, 16)
    c.rotate(angle)
    c.translate(-16, -16)
    fillStroke(c, new Path2D('M16 4 L21 10 L18 10 L18 22 L21 22 L16 28 L11 22 L14 22 L14 10 L11 10 Z'), pal)
  }, 16, 16)

const move = (pal: Palette): CursorArt =>
  make(
    (c) =>
      fillStroke(
        c,
        new Path2D('M16 3 L20 7.5 L17.4 7.5 L17.4 14.6 L24.5 14.6 L24.5 12 L29 16 L24.5 20 L24.5 17.4 L17.4 17.4 L17.4 24.5 L20 24.5 L16 29 L12 24.5 L14.6 24.5 L14.6 17.4 L7.5 17.4 L7.5 20 L3 16 L7.5 12 L7.5 14.6 L14.6 14.6 L14.6 7.5 L12 7.5 Z'),
        pal
      ),
    16,
    16
  )

const wait = (): CursorArt =>
  make((c) => {
    c.beginPath()
    c.arc(16, 16, 9, 0, Math.PI * 2)
    c.lineWidth = 5
    c.strokeStyle = '#fff'
    c.stroke()
    c.shadowColor = 'transparent'
    c.beginPath()
    c.arc(16, 16, 9, -Math.PI / 2, Math.PI)
    c.lineWidth = 3
    c.strokeStyle = '#3b82f6'
    c.stroke()
  }, 16, 16)

const no = (): CursorArt =>
  make((c) => {
    c.beginPath()
    c.arc(16, 16, 9, 0, Math.PI * 2)
    c.moveTo(9.6, 9.6)
    c.lineTo(22.4, 22.4)
    c.lineWidth = 5
    c.strokeStyle = '#fff'
    c.stroke()
    c.shadowColor = 'transparent'
    c.lineWidth = 2.6
    c.strokeStyle = '#ef4444'
    c.stroke()
  }, 16, 16)

const cache = new Map<CursorArtStyle, Record<CursorKind, CursorArt>>()

export function cursorArt(style: CursorArtStyle = 'classic'): Record<CursorKind, CursorArt> {
  let set = cache.get(style)
  if (!set) {
    const pal = PALETTES[style] ?? PALETTES.classic
    set = {
      arrow: arrow(pal),
      hand: hand(pal),
      ibeam: ibeam(pal),
      wait: wait(),
      cross: cross(pal),
      move: move(pal),
      ns: resize(0, pal),
      ew: resize(Math.PI / 2, pal),
      nwse: resize(-Math.PI / 4, pal),
      nesw: resize(Math.PI / 4, pal),
      no: no()
    }
    cache.set(style, set)
  }
  return set
}

export const CURSOR_ART_STYLES: { id: CursorArtStyle; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'light', label: 'Light' },
  { id: 'solid', label: 'Solid' },
  { id: 'gradient', label: 'Gradient' }
]

/** Logical cursor height in source pixels at 100% scaling. */
export const CURSOR_BASE_PX = 32
