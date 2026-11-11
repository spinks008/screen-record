// Crisp vector cursors drawn to canvases (we never copy OS or third-party cursor bitmaps).
import type { CursorKind } from '@shared/types'

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

function fillStroke(c: CanvasRenderingContext2D, p: Path2D, fill = '#111', stroke = '#fff', width = 1.6): void {
  c.lineWidth = width * 2
  c.strokeStyle = stroke
  c.stroke(p)
  c.shadowColor = 'transparent'
  c.fillStyle = fill
  c.fill(p)
}

const arrow = (): CursorArt =>
  make((c) => fillStroke(c, new Path2D('M6 3 L6 23 L11 18.5 L14.5 26 L17.5 24.6 L14.2 17.4 L20.5 17.4 Z')), 6 / 1, 3 / 1)

const hand = (): CursorArt =>
  make(
    (c) =>
      fillStroke(
        c,
        new Path2D(
          'M12 4.5c0-1.2 2.8-1.2 2.8 0V13l.2-2.1c0-1.2 2.7-1.2 2.7 0v2.3l.2-1.6c0-1.2 2.6-1.2 2.6 0v2.2l.3-1c.2-1.1 2.5-.9 2.4.3l-.4 6.4c-.2 2.8-2 5.6-5.4 5.6h-2.6c-2.2 0-3.4-1-4.6-2.7l-3.6-5.4c-.7-1.1.9-2.5 2-1.4l1.4 1.5z'
        )
      ),
    13.4,
    4
  )

const ibeam = (): CursorArt =>
  make((c) => {
    const p = new Path2D('M12 5h3l1 1 1-1h3M16 6v20M12 27h3l1-1 1 1h3')
    c.lineWidth = 4.5
    c.strokeStyle = '#fff'
    c.stroke(p)
    c.shadowColor = 'transparent'
    c.lineWidth = 1.8
    c.strokeStyle = '#111'
    c.stroke(p)
  }, 16, 16)

const cross = (): CursorArt =>
  make((c) => {
    const p = new Path2D('M16 5v22M5 16h22')
    c.lineWidth = 4.5
    c.strokeStyle = '#fff'
    c.stroke(p)
    c.shadowColor = 'transparent'
    c.lineWidth = 1.8
    c.strokeStyle = '#111'
    c.stroke(p)
  }, 16, 16)

const resize = (angle: number): CursorArt =>
  make((c) => {
    c.translate(16, 16)
    c.rotate(angle)
    c.translate(-16, -16)
    fillStroke(c, new Path2D('M16 4 L21 10 L18 10 L18 22 L21 22 L16 28 L11 22 L14 22 L14 10 L11 10 Z'))
  }, 16, 16)

const move = (): CursorArt =>
  make(
    (c) =>
      fillStroke(
        c,
        new Path2D('M16 3 L20 7.5 L17.4 7.5 L17.4 14.6 L24.5 14.6 L24.5 12 L29 16 L24.5 20 L24.5 17.4 L17.4 17.4 L17.4 24.5 L20 24.5 L16 29 L12 24.5 L14.6 24.5 L14.6 17.4 L7.5 17.4 L7.5 20 L3 16 L7.5 12 L7.5 14.6 L14.6 14.6 L14.6 7.5 L12 7.5 Z')
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

let cache: Record<CursorKind, CursorArt> | null = null

export function cursorArt(): Record<CursorKind, CursorArt> {
  cache ??= {
    arrow: arrow(),
    hand: hand(),
    ibeam: ibeam(),
    wait: wait(),
    cross: cross(),
    move: move(),
    ns: resize(0),
    ew: resize(Math.PI / 2),
    nwse: resize(-Math.PI / 4),
    nesw: resize(Math.PI / 4),
    no: no()
  }
  return cache
}

/** Logical cursor height in source pixels at 100% scaling. */
export const CURSOR_BASE_PX = 32
