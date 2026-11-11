// Global mouse/keyboard logging during a recording (wall-clock ms, physical screen pixels).
import { uIOhook, UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent, type UiohookWheelEvent } from 'uiohook-napi'
import type { CursorKind } from '@shared/types'
import { cursorState } from './winApi'

export type RawEvent =
  | { type: 'move'; t: number; x: number; y: number; cursor?: CursorKind }
  | { type: 'down' | 'up'; t: number; x: number; y: number; button: 1 | 2 | 3 }
  | { type: 'wheel'; t: number; x: number; y: number; delta: number }
  | { type: 'key'; t: number; key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }

const keyNames = new Map<number, string>()
for (const [name, code] of Object.entries(UiohookKey)) {
  if (!keyNames.has(code)) keyNames.set(code, name)
}
const MODIFIER_KEYS = new Set(['Ctrl', 'CtrlRight', 'Shift', 'ShiftRight', 'Alt', 'AltRight', 'Meta', 'MetaRight'])

const PRETTY: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Enter: '⏎', Backspace: '⌫', Escape: 'Esc', Space: 'Space', Delete: 'Del',
  Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.', Slash: '/',
  Backquote: '`', BracketLeft: '[', Backslash: '\\', BracketRight: ']', Quote: "'"
}

let hookStarted = false

export class InputTracker {
  private events: RawEvent[] = []
  private active = false
  private lastMoveAt = 0
  private lastCursor: CursorKind = 'arrow'
  private lastPolled = { x: NaN, y: NaN }
  private poll: NodeJS.Timeout | null = null

  private onMove = (e: UiohookMouseEvent): void => {
    if (!this.active) return
    const t = Date.now()
    if (t - this.lastMoveAt < 4) return
    this.lastMoveAt = t
    this.events.push({ type: 'move', t, x: e.x, y: e.y })
  }

  private onDown = (e: UiohookMouseEvent): void => {
    if (!this.active) return
    this.events.push({ type: 'down', t: Date.now(), x: e.x, y: e.y, button: (Number(e.button) || 1) as 1 | 2 | 3 })
  }

  private onUp = (e: UiohookMouseEvent): void => {
    if (!this.active) return
    this.events.push({ type: 'up', t: Date.now(), x: e.x, y: e.y, button: (Number(e.button) || 1) as 1 | 2 | 3 })
  }

  private onWheel = (e: UiohookWheelEvent): void => {
    if (!this.active) return
    this.events.push({ type: 'wheel', t: Date.now(), x: e.x, y: e.y, delta: e.rotation })
  }

  private onKey = (e: UiohookKeyboardEvent): void => {
    if (!this.active) return
    const name = keyNames.get(e.keycode)
    if (!name || MODIFIER_KEYS.has(name)) return
    this.events.push({
      type: 'key',
      t: Date.now(),
      key: PRETTY[name] ?? name,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey
    })
  }

  start(): void {
    this.events = []
    uIOhook.on('mousemove', this.onMove)
    uIOhook.on('mousedown', this.onDown)
    uIOhook.on('mouseup', this.onUp)
    uIOhook.on('wheel', this.onWheel)
    uIOhook.on('keydown', this.onKey)
    if (!hookStarted) {
      uIOhook.start()
      hookStarted = true
    }
    this.active = true
    // Cursor shape is not in the hook events; poll it, and record its position too so that
    // a cursor that never moves still has a known location.
    this.poll = setInterval(() => {
      if (!this.active) return
      const s = cursorState()
      if (!s) return
      const t = Date.now()
      const moved = s.x !== this.lastPolled.x || s.y !== this.lastPolled.y
      this.lastPolled = { x: s.x, y: s.y }
      if (s.kind !== this.lastCursor || this.events.length === 0) {
        this.lastCursor = s.kind
        this.events.push({ type: 'move', t, x: s.x, y: s.y, cursor: s.kind })
      } else if (moved && t - this.lastMoveAt > 50) {
        // Movement the hook did not report (e.g. synthetic/remote input).
        this.lastMoveAt = t
        this.events.push({ type: 'move', t, x: s.x, y: s.y })
      }
    }, 33)
  }

  pause(): void {
    this.active = false
  }

  resume(): void {
    this.active = true
  }

  stop(): RawEvent[] {
    this.active = false
    if (this.poll) clearInterval(this.poll)
    this.poll = null
    uIOhook.off('mousemove', this.onMove)
    uIOhook.off('mousedown', this.onDown)
    uIOhook.off('mouseup', this.onUp)
    uIOhook.off('wheel', this.onWheel)
    uIOhook.off('keydown', this.onKey)
    return this.events
  }
}

export function shutdownInputHook(): void {
  if (hookStarted) {
    uIOhook.stop()
    hookStarted = false
  }
}
