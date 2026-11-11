// Projects live in Videos\Screen Record\Projects\<id>\ with a project.json next to the media files.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InputEvent, Project, ProjectSummary } from '@shared/types'
import { projectsRoot } from '../paths'
import { normalizeStyle } from '../../../src/engine/defaults'

export function projectDir(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid project id')
  return join(projectsRoot(), id)
}

export function newProjectId(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `rec-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function createProjectDir(id: string): string {
  const dir = projectDir(id)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function loadProject(id: string): Project {
  const project = JSON.parse(readFileSync(join(projectDir(id), 'project.json'), 'utf8')) as Project
  // Older projects get the current style shape (new fields defaulted, old ones mapped).
  project.edit.style = normalizeStyle(project.edit.style)
  return project
}

export function saveProject(project: Project): void {
  const dir = projectDir(project.id)
  const tmp = join(dir, 'project.json.tmp')
  writeFileSync(tmp, JSON.stringify(project, null, 1))
  renameSync(tmp, join(dir, 'project.json'))
}

export function loadEvents(id: string): InputEvent[] {
  const file = join(projectDir(id), 'events.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as InputEvent[]) : []
}

export function listProjects(): ProjectSummary[] {
  const root = projectsRoot()
  if (!existsSync(root)) return []
  const out: ProjectSummary[] = []
  for (const name of readdirSync(root)) {
    const file = join(root, name, 'project.json')
    if (!existsSync(file)) continue
    try {
      const p = JSON.parse(readFileSync(file, 'utf8')) as Project
      out.push({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        durationMs: p.durationMs,
        thumbnail: existsSync(join(root, name, 'thumb.jpg')) ? `media://project/${p.id}/thumb.jpg` : null
      })
    } catch {
      /* skip unreadable projects */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export function deleteProject(id: string): void {
  rmSync(projectDir(id), { recursive: true, force: true })
}

export function renameProject(id: string, name: string): void {
  const p = loadProject(id)
  p.name = name.trim() || p.name
  saveProject(p)
}
