// Creation and lookup of every app window. All windows load the same renderer bundle with a hash route.
import { BrowserWindow, ipcMain, screen, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Rect } from '@shared/types'

const preload = join(__dirname, '../preload/index.js')

const windows = {
  dashboard: null as BrowserWindow | null,
  picker: null as BrowserWindow | null,
  toolbar: null as BrowserWindow | null,
  bubble: null as BrowserWindow | null,
  capture: null as BrowserWindow | null,
  countdown: null as BrowserWindow | null,
  area: [] as BrowserWindow[],
  editors: new Map<string, BrowserWindow>()
}

const DARK_BG = '#0d0d12'

function load(win: BrowserWindow, route: string): void {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void win.loadURL(`${dev}#${route}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
}

function create(route: string, opts: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    backgroundColor: DARK_BG,
    autoHideMenuBar: true,
    ...opts,
    webPreferences: { preload, sandbox: false, contextIsolation: true, backgroundThrottling: false, ...opts.webPreferences }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  load(win, route)
  return win
}

const titleBar: Partial<Electron.BrowserWindowConstructorOptions> = {
  titleBarStyle: 'hidden',
  titleBarOverlay: { color: DARK_BG, symbolColor: '#e5e7eb', height: 40 }
}

export function showDashboard(): BrowserWindow {
  if (windows.dashboard && !windows.dashboard.isDestroyed()) {
    windows.dashboard.show()
    windows.dashboard.focus()
    return windows.dashboard
  }
  const win = create('dashboard', { width: 1180, height: 760, minWidth: 820, minHeight: 560, title: 'Screen Record', ...titleBar })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => (windows.dashboard = null))
  windows.dashboard = win
  return win
}

export function hideDashboard(): void {
  windows.dashboard?.hide()
}

export function showPicker(): BrowserWindow {
  if (windows.picker && !windows.picker.isDestroyed()) {
    windows.picker.show()
    windows.picker.focus()
    return windows.picker
  }
  const work = screen.getPrimaryDisplay().workArea
  const width = 440
  const height = 680
  const win = create('picker', {
    width,
    height,
    x: Math.round(work.x + work.width - width - 24),
    y: Math.round(work.y + (work.height - height) / 2),
    frame: false,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: 'New Recording'
  })
  win.setContentProtection(true)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => (windows.picker = null))
  windows.picker = win
  return win
}

export function closePicker(): void {
  windows.picker?.close()
}

export function pickerWindow(): BrowserWindow | null {
  return windows.picker && !windows.picker.isDestroyed() ? windows.picker : null
}

export function showToolbar(avoidDisplayId?: number): BrowserWindow {
  windows.toolbar?.close()
  const displays = screen.getAllDisplays()
  const display = displays.find((d) => d.id !== avoidDisplayId && displays.length > 1) ?? screen.getPrimaryDisplay()
  const width = 380
  const height = 64
  const win = create('toolbar', {
    width,
    height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + display.workArea.height - height - 24),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // Excluded from screen capture (WDA_EXCLUDEFROMCAPTURE).
  win.setContentProtection(true)
  win.once('ready-to-show', () => win.showInactive())
  win.on('closed', () => (windows.toolbar = null))
  windows.toolbar = win
  return win
}

export function closeToolbar(): void {
  windows.toolbar?.close()
}

export function showBubble(deviceId: string): BrowserWindow {
  if (windows.bubble && !windows.bubble.isDestroyed()) {
    windows.bubble.webContents.send('bubble:device', deviceId)
    windows.bubble.showInactive()
    return windows.bubble
  }
  const work = screen.getPrimaryDisplay().workArea
  const size = 200
  const win = create(`bubble?device=${encodeURIComponent(deviceId)}`, {
    width: size,
    height: size,
    x: work.x + 32,
    y: work.y + work.height - size - 32,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // The camera is composited from camera.webm later, so keep the live bubble out of the screen recording.
  win.setContentProtection(true)
  win.once('ready-to-show', () => win.showInactive())
  win.on('closed', () => (windows.bubble = null))
  windows.bubble = win
  return win
}

export function closeBubble(): void {
  windows.bubble?.close()
}

export function captureWindow(): BrowserWindow {
  if (windows.capture && !windows.capture.isDestroyed()) return windows.capture
  const win = create('capture', { width: 320, height: 240, show: false, skipTaskbar: true })
  win.on('closed', () => (windows.capture = null))
  windows.capture = win
  return win
}

export async function waitForLoad(win: BrowserWindow): Promise<void> {
  if (!win.webContents.isLoading()) return
  await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
}

export function showCountdown(displayBoundsDip: Rect): Promise<void> {
  windows.countdown?.close()
  const size = 260
  const win = create('countdown', {
    width: size,
    height: size,
    x: Math.round(displayBoundsDip.x + (displayBoundsDip.width - size) / 2),
    y: Math.round(displayBoundsDip.y + (displayBoundsDip.height - size) / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  win.setContentProtection(true)
  win.once('ready-to-show', () => win.showInactive())
  windows.countdown = win
  return new Promise((resolve) => {
    ipcMain.once('countdown:done', () => {
      win.close()
      windows.countdown = null
      resolve()
    })
    win.on('closed', () => resolve())
  })
}

/** Opens a selection overlay on each display; resolves with the selected rect in DIP or null. */
export function selectArea(): Promise<{ displayId: number; rect: Rect } | null> {
  for (const w of windows.area) w.close()
  windows.area = []
  windows.picker?.hide()
  return new Promise((resolve) => {
    let done = false
    const finish = (result: { displayId: number; rect: Rect } | null): void => {
      if (done) return
      done = true
      ipcMain.removeAllListeners('area:done')
      for (const w of windows.area) if (!w.isDestroyed()) w.close()
      windows.area = []
      windows.picker?.show()
      resolve(result)
    }
    ipcMain.on('area:done', (_e, result: { displayId: number; rect: Rect } | null) => finish(result))
    for (const d of screen.getAllDisplays()) {
      const win = create(`area?display=${d.id}`, {
        ...d.bounds,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        enableLargerThanScreen: true
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setBounds(d.bounds)
      win.once('ready-to-show', () => win.show())
      win.on('closed', () => finish(null))
      windows.area.push(win)
    }
  })
}

export function openEditor(projectId: string): BrowserWindow {
  const existing = windows.editors.get(projectId)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return existing
  }
  const win = create(`editor?project=${projectId}`, {
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Screen Record — Editor',
    ...titleBar
  })
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })
  win.on('closed', () => windows.editors.delete(projectId))
  windows.editors.set(projectId, win)
  return win
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

/** Sends a request to a renderer and waits for its reply on `<channel>:reply:<id>`. */
export function rendererRequest<T>(win: BrowserWindow, channel: string, payload: object, timeoutMs = 20000): Promise<T> {
  const id = randomUUID()
  const reply = `${channel}:reply:${id}`
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      ipcMain.removeAllListeners(reply)
      reject(new Error(`${channel} timed out`))
    }, timeoutMs)
    ipcMain.once(reply, (_e, result: T & { error?: string }) => {
      clearTimeout(timer)
      if (result && typeof result === 'object' && 'error' in result && result.error) reject(new Error(result.error))
      else resolve(result)
    })
    win.webContents.send(channel, { id, ...payload })
  })
}
