import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '@shared/types'

const DEFAULTS: Settings = {
  fps: 60,
  micDeviceId: null,
  systemAudio: true,
  cameraDeviceId: null,
  countdown: true,
  presets: [],
  defaultPresetId: null,
  exportFolder: null
}

let cache: Settings | null = null

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): Settings {
  if (cache) return cache
  try {
    cache = existsSync(file()) ? { ...DEFAULTS, ...JSON.parse(readFileSync(file(), 'utf8')) } : { ...DEFAULTS }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache!
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch }
  writeFileSync(file(), JSON.stringify(cache, null, 2))
  return cache
}
