import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session as electronSession, shell, Tray } from 'electron'
import { spawn } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { DisplayInfo, ExportOptions, Project, RecordingOptions, Settings, WindowInfo } from '@shared/types'
import { handleMediaProtocol, registerMediaScheme } from './mediaProtocol'
import { cancelExport, beginExport, finishExport, writeExport } from './export/exportService'
import { deleteProject, listProjects, loadEvents, loadProject, projectDir, renameProject, saveProject } from './projects/store'
import { session } from './recorder/session'
import { shutdownInputHook } from './recorder/inputTracker'
import { listWindows } from './recorder/winApi'
import { pickEncoder } from './recorder/ffmpeg'
import { getSettings, updateSettings } from './settings'
import {
  broadcast,
  closeBubble,
  closePicker,
  hideDashboard,
  openEditor,
  selectArea,
  showBubble,
  showDashboard,
  showPicker
} from './windows'

registerMediaScheme()

if (!app.requestSingleInstanceLock()) app.quit()

let tray: Tray | null = null

function resourcePath(file: string): string {
  return app.isPackaged ? join(process.resourcesPath, file) : join(app.getAppPath(), 'resources', file)
}

async function displays(): Promise<DisplayInfo[]> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 480, height: 270 } })
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => {
    const src = sources.find((s) => s.display_id === String(d.id))
    const phys = screen.dipToScreenRect(null, d.bounds)
    return {
      id: d.id,
      label: d.label || `Display ${i + 1}`,
      bounds: phys,
      scaleFactor: d.scaleFactor,
      primary: d.id === primary,
      thumbnail: src?.thumbnail.toDataURL()
    }
  })
}

async function windowsList(): Promise<WindowInfo[]> {
  const raw = listWindows()
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true })
  return raw.map((w) => {
    const src = sources.find((s) => s.id.startsWith(`window:${w.hwnd}:`))
    return {
      hwnd: String(w.hwnd),
      title: w.title,
      exe: w.exe,
      bounds: w.bounds,
      thumbnail: src?.thumbnail.toDataURL(),
      icon: src?.appIcon?.toDataURL()
    }
  })
}

async function startRecording(opts: RecordingOptions): Promise<void> {
  closePicker()
  hideDashboard()
  if (opts.cameraDeviceId) showBubble(opts.cameraDeviceId)
  else closeBubble()
  try {
    await session.start(opts)
  } catch (err) {
    closeBubble()
    dialog.showErrorBox('Could not start recording', (err as Error).message)
    showPicker()
  }
}

async function stopRecording(): Promise<void> {
  try {
    const id = await session.stop()
    broadcast('projects:changed')
    openEditor(id)
  } catch (err) {
    dialog.showErrorBox('Recording failed', (err as Error).message)
    showDashboard()
  }
}

function toggleRecording(): void {
  const s = session.status.state
  if (s === 'recording' || s === 'paused') void stopRecording()
  else if (s === 'idle') showPicker()
}

function registerIpc(): void {
  ipcMain.handle('sources:displays', () => displays())
  ipcMain.handle('sources:windows', () => windowsList())
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => updateSettings(patch))

  ipcMain.handle('picker:open', () => void showPicker())
  ipcMain.handle('picker:close', () => {
    closePicker()
    closeBubble()
  })
  ipcMain.handle('bubble:show', (_e, deviceId: string) => void showBubble(deviceId))
  ipcMain.handle('bubble:hide', () => closeBubble())
  ipcMain.handle('area:select', () => selectArea())

  ipcMain.handle('recorder:start', (_e, opts: RecordingOptions) => startRecording(opts))
  ipcMain.handle('recorder:stop', () => stopRecording())
  ipcMain.handle('recorder:pause', () => session.pause())
  ipcMain.handle('recorder:resume', () => session.resume())
  ipcMain.handle('recorder:restart', () => session.restart())
  ipcMain.handle('recorder:discard', async () => {
    await session.discard()
    closeBubble()
    showDashboard()
  })
  ipcMain.handle('recorder:status', () => session.status)

  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:get', (_e, id: string) => loadProject(id))
  ipcMain.handle('projects:events', (_e, id: string) => loadEvents(id))
  ipcMain.handle('projects:save', (_e, p: Project) => saveProject(p))
  ipcMain.handle('projects:delete', (_e, id: string) => {
    deleteProject(id)
    broadcast('projects:changed')
  })
  ipcMain.handle('projects:rename', (_e, id: string, name: string) => {
    renameProject(id, name)
    broadcast('projects:changed')
  })
  ipcMain.handle('projects:open', (_e, id: string) => void openEditor(id))
  ipcMain.handle('projects:import-image', async (e, id: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose background image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const name = `bg-${Date.now()}${extname(r.filePaths[0]).toLowerCase()}`
    copyFileSync(r.filePaths[0], join(projectDir(id), name))
    return `media://project/${id}/${name}`
  })

  ipcMain.handle('export:begin', (_e, projectId: string) => beginExport(projectId))
  ipcMain.handle('export:write', (_e, token: string, position: number, data: Uint8Array) => writeExport(token, position, data))
  ipcMain.handle('export:cancel', (_e, token: string) => cancelExport(token))
  ipcMain.handle('export:finish', (e, token: string, opts: ExportOptions) =>
    finishExport(token, opts, (p) => {
      if (!e.sender.isDestroyed()) e.sender.send('export:progress', p)
    })
  )
  ipcMain.handle('export:choose-folder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return getSettings()
    return updateSettings({ exportFolder: r.filePaths[0] })
  })

  ipcMain.handle('shell:show', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:open', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('clipboard:file', (_e, path: string) => {
    // Puts the file itself on the clipboard (CF_HDROP) so it can be pasted into chats and folders.
    const escaped = path.replace(/'/g, "''")
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -LiteralPath '${escaped}'`], { windowsHide: true })
  })

  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.handle('window:dashboard', () => void showDashboard())
}

function setupMediaPermissions(): void {
  const ses = electronSession.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => ['media', 'display-capture'].includes(permission))
  // getDisplayMedia() from the capture window: we only want the system audio loopback.
  ses.setDisplayMediaRequestHandler(async (_req, cb) => {
    const [source] = await desktopCapturer.getSources({ types: ['screen'] })
    cb({ video: source, audio: 'loopback' })
  })
}

function setupTray(): void {
  tray = new Tray(nativeImage.createFromPath(resourcePath('tray.png')))
  tray.setToolTip('Screen Record')
  const menu = (): Electron.Menu =>
    Menu.buildFromTemplate([
      { label: 'New Recording', accelerator: 'Ctrl+Shift+R', click: () => toggleRecording() },
      { label: 'Open Screen Record', click: () => showDashboard() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  tray.setContextMenu(menu())
  tray.on('click', () => {
    const s = session.status.state
    if (s === 'recording' || s === 'paused') void stopRecording()
    else showDashboard()
  })
}

app.on('second-instance', () => showDashboard())

app.whenReady().then(() => {
  app.setAppUserModelId('com.screenrecord.app')
  handleMediaProtocol()
  setupMediaPermissions()
  registerIpc()
  setupTray()
  globalShortcut.register('Ctrl+Shift+R', toggleRecording)
  globalShortcut.register('Ctrl+Shift+P', () => {
    if (session.status.state === 'recording') void session.pause()
    else if (session.status.state === 'paused') void session.resume()
  })
  void pickEncoder()
  showDashboard()
})

// Stay in the tray when all windows close; quit only from the tray menu.
app.on('window-all-closed', () => {
  /* keep running */
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  shutdownInputHook()
})
