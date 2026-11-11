// Damped spring shared by the cursor and the camera: tension, friction and mass, like a physical spring.
import type { MotionPreset, MotionSettings, SpringConfig } from '@shared/types'

/** Cursor springs. Slow, quick and rapid match the old slow/fast/rapid smoothing exactly. */
export const CURSOR_PRESETS: Record<MotionPreset, SpringConfig> = {
  slow: { tension: 90, friction: 19, mass: 1 },
  medium: { tension: 170, friction: 26, mass: 1 },
  quick: { tension: 260, friction: 32, mass: 1 },
  rapid: { tension: 650, friction: 51, mass: 1 }
}

/**
 * Camera springs, critically damped (friction = 2·√tension), so zooms never overshoot.
 * Slow is the previous engine's camera (ω = 7); quick reaches 90% of a visible zoom in ~0.42 s.
 */
export const SCREEN_PRESETS: Record<MotionPreset, SpringConfig> = {
  slow: { tension: 49, friction: 14, mass: 1 },
  medium: { tension: 100, friction: 20, mass: 1 },
  quick: { tension: 144, friction: 24, mass: 1 },
  rapid: { tension: 256, friction: 32, mass: 1 }
}

export function motionFromPreset(table: Record<MotionPreset, SpringConfig>, preset: MotionPreset): MotionSettings {
  return { preset, ...table[preset] }
}

/** The spring to use for a cursor setting, or null when smoothing is off. */
export function cursorSpring(m: MotionSettings): SpringConfig | null {
  if (m.preset === 'off') return null
  if (m.preset !== 'custom') return CURSOR_PRESETS[m.preset]
  return sanitize(m)
}

export function screenSpring(m: MotionSettings): SpringConfig {
  if (m.preset !== 'custom' && m.preset !== 'off') return SCREEN_PRESETS[m.preset]
  return sanitize(m)
}

function sanitize(s: SpringConfig): SpringConfig {
  return { tension: Math.max(1, s.tension), friction: Math.max(0.5, s.friction), mass: Math.max(0.1, s.mass) }
}

export interface SpringState {
  x: number
  v: number
}

/** Advances one spring by `dt` seconds towards `goal`, in substeps of at most 2 ms (semi-implicit Euler). */
export function stepSpring(s: SpringState, goal: number, cfg: SpringConfig, dt: number): void {
  const n = Math.max(1, Math.ceil(dt / 0.002))
  const h = dt / n
  for (let i = 0; i < n; i++) {
    const a = (cfg.tension * (goal - s.x) - cfg.friction * s.v) / cfg.mass
    s.v += a * h
    s.x += s.v * h
  }
}

/** Seconds a step from 0 to 1 takes to reach `fraction` (and stay past it). */
export function settleTime(cfg: SpringConfig, fraction = 0.9, preFilterSec = 0): number {
  const s = { x: 0, v: 0 }
  let g = 0
  const dt = 1 / 1000
  const k = preFilterSec > 0 ? 1 - Math.exp(-dt / preFilterSec) : 1
  let reached = 0
  for (let t = 0; t < 10; t += dt) {
    g += (1 - g) * k
    stepSpring(s, g, cfg, dt)
    if (Math.abs(1 - s.x) <= 1 - fraction) {
      if (!reached) reached = t + dt
    } else reached = 0
  }
  return reached || 10
}
