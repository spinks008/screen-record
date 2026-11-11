// Keystroke overlay: which key labels are on screen at a given time.
import type { InputEvent, Style } from '@shared/types'

export interface KeyPill {
  label: string
  start: number
  end: number
}

const SHOW_MS = 1300
const TYPE_GAP_MS = 900

type KeyEvent = Extract<InputEvent, { type: 'key' }>

function comboLabel(e: KeyEvent): string {
  const parts: string[] = []
  if (e.ctrl) parts.push('Ctrl')
  if (e.alt) parts.push('Alt')
  if (e.shift) parts.push('Shift')
  if (e.meta) parts.push('Win')
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return parts.join(' + ')
}

function isCombo(e: KeyEvent): boolean {
  if (e.ctrl || e.alt || e.meta) return true
  // Shift + navigation/special keys reads as a shortcut; Shift + letter is just typing.
  return e.shift && e.key.length > 1 && e.key !== 'Space'
}

function typedChar(e: KeyEvent): string | null {
  if (e.key === 'Space') return ' '
  if (e.key.length === 1) return e.shift ? e.key.toUpperCase() : e.key.toLowerCase()
  return null
}

/** Precomputes the pills shown over the whole recording. */
export function buildKeyPills(events: InputEvent[], mode: Style['keys']['mode']): KeyPill[] {
  const pills: KeyPill[] = []
  let typing: KeyPill | null = null
  for (const ev of events) {
    if (ev.type !== 'key') continue
    if (isCombo(ev)) {
      typing = null
      const label = comboLabel(ev)
      const last = pills[pills.length - 1]
      if (last && last.label.replace(/ ×\d+$/, '') === label && ev.t - last.end + SHOW_MS < 700) {
        const n = Number(/×(\d+)$/.exec(last.label)?.[1] ?? 1) + 1
        last.label = `${label} ×${n}`
        last.end = ev.t + SHOW_MS
      } else {
        pills.push({ label, start: ev.t, end: ev.t + SHOW_MS })
      }
      continue
    }
    if (mode !== 'all') continue
    const ch = typedChar(ev)
    if (ch !== null && typing && ev.t - (typing.end - SHOW_MS) < TYPE_GAP_MS) {
      typing.label = (typing.label + ch).slice(-28)
      typing.end = ev.t + SHOW_MS
    } else if (ch !== null) {
      typing = { label: ch, start: ev.t, end: ev.t + SHOW_MS }
      pills.push(typing)
    } else {
      typing = null
      pills.push({ label: ev.key, start: ev.t, end: ev.t + SHOW_MS })
    }
  }
  // A pill ends as soon as the next one starts.
  for (let i = 0; i < pills.length - 1; i++) pills[i].end = Math.min(pills[i].end, pills[i + 1].start)
  return pills
}

export function pillAt(pills: KeyPill[], t: number): { label: string; alpha: number; pop: number } | null {
  for (let i = pills.length - 1; i >= 0; i--) {
    const p = pills[i]
    if (p.start > t) continue
    if (t >= p.end + 200) return null
    const fadeIn = Math.min(1, (t - p.start) / 120)
    const fadeOut = t > p.end ? 1 - (t - p.end) / 200 : 1
    return { label: p.label, alpha: Math.max(0, Math.min(fadeIn, fadeOut)), pop: fadeIn }
  }
  return null
}
