// Editor state: the project being edited, selection, playhead, and undo/redo via immer patches.
import { create } from 'zustand'
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer'
import type { EditState, InputEvent, Project } from '@shared/types'
import { api } from '../lib/api'

enablePatches()

export type SegmentTrack = 'cuts' | 'speeds' | 'zooms' | 'masks' | 'cameraSegments'

export interface Selection {
  track: SegmentTrack
  id: string
}

interface HistoryEntry {
  patches: Patch[]
  inverse: Patch[]
  /** Edits with the same key inside a short window collapse into one undo step (e.g. dragging a slider). */
  key?: string
  at: number
}

interface EditorState {
  project: Project | null
  events: InputEvent[]
  selection: Selection | null
  /** Source-time playhead in ms. */
  time: number
  playing: boolean
  past: HistoryEntry[]
  future: HistoryEntry[]
  load(id: string): Promise<void>
  edit(recipe: (draft: EditState) => void, key?: string): void
  undo(): void
  redo(): void
  select(sel: Selection | null): void
  setTime(t: number): void
  setPlaying(p: boolean): void
  rename(name: string): void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(project: Project): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void api.saveProject(project), 400)
}

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  events: [],
  selection: null,
  time: 0,
  playing: false,
  past: [],
  future: [],

  async load(id) {
    const [project, events] = await Promise.all([api.getProject(id), api.getEvents(id)])
    set({ project, events, time: project.edit.trimStart, past: [], future: [], selection: null })
  },

  edit(recipe, key) {
    const { project, past } = get()
    if (!project) return
    const [next, patches, inverse] = produceWithPatches(project.edit, recipe)
    if (!patches.length) return
    const now = Date.now()
    const last = past[past.length - 1]
    let newPast: HistoryEntry[]
    if (key && last && last.key === key && now - last.at < 800) {
      // Merge into the previous step: keep its inverse, extend its forward patches.
      newPast = [...past.slice(0, -1), { patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse], key, at: now }]
    } else {
      newPast = [...past, { patches, inverse, key, at: now }].slice(-200)
    }
    const updated = { ...project, edit: next }
    set({ project: updated, past: newPast, future: [] })
    scheduleSave(updated)
  },

  undo() {
    const { project, past, future } = get()
    const entry = past[past.length - 1]
    if (!project || !entry) return
    const updated = { ...project, edit: applyPatches(project.edit, entry.inverse) }
    set({ project: updated, past: past.slice(0, -1), future: [entry, ...future] })
    scheduleSave(updated)
  },

  redo() {
    const { project, past, future } = get()
    const entry = future[0]
    if (!project || !entry) return
    const updated = { ...project, edit: applyPatches(project.edit, entry.patches) }
    set({ project: updated, past: [...past, { ...entry, at: 0 }], future: future.slice(1) })
    scheduleSave(updated)
  },

  select(selection) {
    set({ selection })
  },

  setTime(t) {
    const p = get().project
    set({ time: p ? Math.max(0, Math.min(p.durationMs, t)) : t })
  },

  setPlaying(playing) {
    set({ playing })
  },

  rename(name) {
    const p = get().project
    if (!p) return
    const updated = { ...p, name }
    set({ project: updated })
    scheduleSave(updated)
  }
}))

export function findSegment(edit: EditState, sel: Selection | null): { start: number; end: number; id: string } | undefined {
  if (!sel) return undefined
  return (edit[sel.track] as { id: string; start: number; end: number }[]).find((s) => s.id === sel.id)
}
