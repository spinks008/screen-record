// Maps between source (recording) time and output (exported) time through trims, cuts and speed changes.
import type { EditState, Segment } from '@shared/types'

export interface Piece {
  srcStart: number
  srcEnd: number
  speed: number
  outStart: number
  outEnd: number
}

function mergeRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start)
  const out: { start: number; end: number }[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/** Source ranges that survive trimming and cuts. */
export function keptRanges(edit: Pick<EditState, 'trimStart' | 'trimEnd' | 'cuts'>, durationMs: number): { start: number; end: number }[] {
  const start = Math.max(0, edit.trimStart)
  const end = Math.min(durationMs, edit.trimEnd > 0 ? edit.trimEnd : durationMs)
  const cuts = mergeRanges(edit.cuts.map((c) => ({ start: c.start, end: c.end })))
  const kept: { start: number; end: number }[] = []
  let cursor = start
  for (const c of cuts) {
    if (c.end <= cursor) continue
    if (c.start >= end) break
    if (c.start > cursor) kept.push({ start: cursor, end: Math.min(c.start, end) })
    cursor = Math.max(cursor, c.end)
  }
  if (cursor < end) kept.push({ start: cursor, end })
  return kept
}

export function buildPieces(edit: Pick<EditState, 'trimStart' | 'trimEnd' | 'cuts' | 'speeds'>, durationMs: number): Piece[] {
  const kept = keptRanges(edit, durationMs)
  const speeds = [...edit.speeds].filter((s) => s.end > s.start && s.speed > 0).sort((a, b) => a.start - b.start)
  const pieces: Piece[] = []
  let out = 0
  const push = (srcStart: number, srcEnd: number, speed: number): void => {
    if (srcEnd - srcStart < 0.5) return
    const len = (srcEnd - srcStart) / speed
    pieces.push({ srcStart, srcEnd, speed, outStart: out, outEnd: out + len })
    out += len
  }
  for (const k of kept) {
    // Boundaries inside this kept range where speed may change.
    const marks = new Set<number>([k.start, k.end])
    for (const s of speeds) {
      if (s.start > k.start && s.start < k.end) marks.add(s.start)
      if (s.end > k.start && s.end < k.end) marks.add(s.end)
    }
    const points = [...marks].sort((a, b) => a - b)
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      const mid = (a + b) / 2
      const seg = speeds.find((s) => s.start <= mid && s.end > mid)
      push(a, b, seg ? seg.speed : 1)
    }
  }
  return pieces
}

export function outputDuration(pieces: Piece[]): number {
  return pieces.length ? pieces[pieces.length - 1].outEnd : 0
}

/** Output time for a source time, or null when that source time is cut away. */
export function srcToOut(pieces: Piece[], src: number): number | null {
  for (const p of pieces) {
    if (src >= p.srcStart && src < p.srcEnd) return p.outStart + (src - p.srcStart) / p.speed
  }
  const last = pieces[pieces.length - 1]
  if (last && Math.abs(src - last.srcEnd) < 1) return last.outEnd
  return null
}

export function outToSrc(pieces: Piece[], out: number): number {
  if (!pieces.length) return 0
  if (out <= 0) return pieces[0].srcStart
  for (const p of pieces) {
    if (out < p.outEnd) return p.srcStart + (out - p.outStart) * p.speed
  }
  return pieces[pieces.length - 1].srcEnd
}

/** The piece containing a source time, or the next one after it (used to skip cuts during playback). */
export function pieceAtOrAfter(pieces: Piece[], src: number): Piece | null {
  for (const p of pieces) {
    if (src < p.srcEnd - 0.5) return p
  }
  return null
}

export function segmentAt<T extends Segment>(segments: T[], t: number): T | undefined {
  return segments.find((s) => t >= s.start && t < s.end)
}
