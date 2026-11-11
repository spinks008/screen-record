import { app } from 'electron'
import { join } from 'node:path'

export function binPath(name: 'ffmpeg' | 'ffprobe'): string {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'resources', 'bin')
  return join(base, `${name}.exe`)
}

export function projectsRoot(): string {
  return join(app.getPath('videos'), 'Screen Record', 'Projects')
}

export function defaultExportFolder(): string {
  return join(app.getPath('videos'), 'Screen Record')
}
