// Mouse click sound: when clicks happen in the output, and a synthesized click sample (no bundled audio).
import type { InputEvent } from '@shared/types'
import { srcToOut, type Piece } from './timeline'

/** Source times (ms) of left-button presses, at most one per 40 ms. */
export function clickSourceTimes(events: InputEvent[]): number[] {
  const times: number[] = []
  for (const e of events) if (e.type === 'down' && e.button === 1) times.push(e.t)
  times.sort((a, b) => a - b)
  return times.filter((t, i) => i === 0 || t - times[i - 1] >= 40)
}

/** Output times (ms) of the clicks that survive trims and cuts, following speed changes. */
export function clickOutputTimes(events: InputEvent[], pieces: Piece[]): number[] {
  const out: number[] = []
  for (const t of clickSourceTimes(events)) {
    const o = srcToOut(pieces, t)
    if (o !== null) out.push(o)
  }
  return out
}

export const CLICK_SAMPLE_RATE = 48000

/**
 * A short, soft "tick": a 1.5 ms noise transient over two damped tones. Deterministic, so the
 * preview and the export sound the same.
 */
export function synthClick(rate = CLICK_SAMPLE_RATE): Float32Array<ArrayBuffer> {
  const n = Math.round(rate * 0.06)
  const out = new Float32Array(n)
  let seed = 0x2545f491
  const noise = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return ((seed >>> 0) / 0xffffffff) * 2 - 1
  }
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const transient = t < 0.0015 ? noise() * (1 - t / 0.0015) * 0.5 : 0
    const body = Math.sin(2 * Math.PI * 2900 * t) * Math.exp(-t / 0.006) * 0.35 + Math.sin(2 * Math.PI * 1450 * t) * Math.exp(-t / 0.012) * 0.3
    // 0.5 ms fade-in avoids a DC click at the very first sample.
    out[i] = (transient + body) * Math.min(1, t / 0.0005)
  }
  return out
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, rate = CLICK_SAMPLE_RATE): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true)
  return new Uint8Array(buf)
}
