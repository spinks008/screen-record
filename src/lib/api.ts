// Typed wrapper over the preload bridge.
import type {
  DisplayInfo,
  ExportOptions,
  InputEvent,
  Project,
  ProjectSummary,
  RecorderStatus,
  RecordingOptions,
  Rect,
  Settings,
  WindowInfo
} from '@shared/types'

interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, ...args: unknown[]): void
  on(channel: string, listener: (...args: any[]) => void): () => void
  reply(channel: string, id: string, result: unknown): void
}

declare global {
  interface Window {
    bridge: Bridge
  }
}

const b = (): Bridge => window.bridge
const call = <T>(channel: string, ...args: unknown[]): Promise<T> => b().invoke(channel, ...args) as Promise<T>

export const api = {
  displays: () => call<DisplayInfo[]>('sources:displays'),
  windows: () => call<WindowInfo[]>('sources:windows'),
  getSettings: () => call<Settings>('settings:get'),
  setSettings: (patch: Partial<Settings>) => call<Settings>('settings:set', patch),

  openPicker: () => call<void>('picker:open'),
  closePicker: () => call<void>('picker:close'),
  showBubble: (deviceId: string) => call<void>('bubble:show', deviceId),
  hideBubble: () => call<void>('bubble:hide'),
  selectArea: () => call<{ displayId: number; rect: Rect } | null>('area:select'),
  areaDone: (result: { displayId: number; rect: Rect } | null) => b().send('area:done', result),
  countdownDone: () => b().send('countdown:done'),

  start: (opts: RecordingOptions) => call<void>('recorder:start', opts),
  stop: () => call<void>('recorder:stop'),
  pause: () => call<void>('recorder:pause'),
  resume: () => call<void>('recorder:resume'),
  restart: () => call<void>('recorder:restart'),
  discard: () => call<void>('recorder:discard'),
  status: () => call<RecorderStatus>('recorder:status'),

  listProjects: () => call<ProjectSummary[]>('projects:list'),
  getProject: (id: string) => call<Project>('projects:get', id),
  getEvents: (id: string) => call<InputEvent[]>('projects:events', id),
  saveProject: (p: Project) => call<void>('projects:save', p),
  deleteProject: (id: string) => call<void>('projects:delete', id),
  renameProject: (id: string, name: string) => call<void>('projects:rename', id, name),
  openProject: (id: string) => call<void>('projects:open', id),
  importImage: (id: string) => call<string | null>('projects:import-image', id),

  exportBegin: (projectId: string) => call<string>('export:begin', projectId),
  exportWrite: (token: string, position: number, data: Uint8Array) => call<void>('export:write', token, position, data),
  exportFinish: (token: string, opts: ExportOptions) => call<string>('export:finish', token, opts),
  exportCancel: (token: string) => call<void>('export:cancel', token),
  chooseExportFolder: () => call<Settings>('export:choose-folder'),

  showInFolder: (path: string) => call<void>('shell:show', path),
  openPath: (path: string) => call<void>('shell:open', path),
  copyFile: (path: string) => call<void>('clipboard:file', path),

  closeWindow: () => call<void>('window:close'),
  minimizeWindow: () => call<void>('window:minimize'),
  openDashboard: () => call<void>('window:dashboard'),

  on: (channel: string, listener: (...args: any[]) => void) => b().on(channel, listener),
  reply: (channel: string, id: string, result: unknown) => b().reply(channel, id, result)
}

export function mediaUrl(projectId: string, file: string): string {
  return `media://project/${projectId}/${encodeURIComponent(file)}`
}

export function formatTime(ms: number, withMs = false): string {
  const total = Math.max(0, ms) / 1000
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  const base = `${m}:${String(s).padStart(2, '0')}`
  return withMs ? `${base}.${String(Math.floor((total % 1) * 10))}` : base
}
