import { useEffect, useRef, useState } from 'react'
import type { ExportOptions } from '@shared/types'
import { api } from '../lib/api'
import { Icon } from '../lib/icons'
import { Inspector } from './Inspector'
import { Preview } from './Preview'
import { Timeline, addSegment } from './Timeline'
import { exportProject, type ExportProgress } from './exporter'
import { useEditor } from './store'
import './editor.css'

export function Editor({ projectId }: { projectId: string }): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    useEditor
      .getState()
      .load(projectId)
      .catch((e) => setError((e as Error).message))
  }, [projectId])

  useEffect(() => {
    if (project) document.title = `${project.name} — Screen Record`
  }, [project?.name])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const s = useEditor.getState()
      const step = (e.shiftKey ? 1000 : 1000 / (s.project?.capture.fps ?? 60))
      if (e.code === 'Space') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      } else if ((e.ctrlKey && e.key.toLowerCase() === 'z' && e.shiftKey) || (e.ctrlKey && e.key.toLowerCase() === 'y')) {
        e.preventDefault()
        s.redo()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        s.undo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) {
        const sel = s.selection
        s.edit((d) => {
          ;(d as any)[sel.track] = (d[sel.track] as { id: string }[]).filter((x) => x.id !== sel.id)
        })
        s.select(null)
      } else if (e.key === 'ArrowLeft') {
        s.setPlaying(false)
        s.setTime(s.time - step)
      } else if (e.key === 'ArrowRight') {
        s.setPlaying(false)
        s.setTime(s.time + step)
      } else if (e.key.toLowerCase() === 'z' && !e.ctrlKey) {
        addSegment('zooms', { zoom: 1.8, mode: 'follow', target: { x: 0.5, y: 0.5 }, auto: false })
      } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey) {
        addSegment('cuts', {}, 1500)
      } else if (e.key === 'Escape') {
        s.select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (error) return <div className="empty">Could not open this project: {error}</div>
  if (!project) return <div className="empty">Loading…</div>

  return (
    <div className="editor">
      <EditorTitle onExport={() => setExporting(true)} />
      <div className="editor-main">
        <Preview />
        <Inspector />
      </div>
      <Timeline />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  )
}

function EditorTitle({ onExport }: { onExport: () => void }): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const { undo, redo, rename } = useEditor.getState()
  const [name, setName] = useState(project.name)
  useEffect(() => setName(project.name), [project.id])
  return (
    <div className="titlebar drag editor-title">
      <button className="btn ghost sm no-drag" onClick={() => api.openDashboard()} title="All recordings">
        <span className="brand-mark" />
      </button>
      <input
        className="title-input no-drag"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== project.name && rename(name.trim())}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div style={{ flex: 1 }} />
      <button className="btn ghost icon no-drag" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
        <Icon.undo />
      </button>
      <button className="btn ghost icon no-drag" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)">
        <Icon.redo />
      </button>
      <button className="btn primary no-drag" onClick={onExport}>
        <Icon.download size={15} /> Export
      </button>
      {/* Space for the native window controls overlay. */}
      <div style={{ width: 140 }} />
    </div>
  )
}

function ExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const events = useEditor((s) => s.events)
  const [opts, setOpts] = useState<ExportOptions>({ format: 'mp4', height: 1080, fps: 60, quality: 'high' })
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const start = async (): Promise<void> => {
    useEditor.getState().setPlaying(false)
    setError(null)
    setResult(null)
    setProgress({ phase: 'render', progress: 0 })
    abort.current = new AbortController()
    try {
      const path = await exportProject(project, events, opts, setProgress, abort.current.signal)
      setResult(path)
    } catch (e) {
      if (!abort.current.signal.aborted) setError((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  const busy = progress !== null
  const pct = progress ? (progress.phase === 'render' ? progress.progress * 0.9 : 0.9 + progress.progress * 0.1) : 0
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]): void => setOpts((o) => ({ ...o, [k]: v }))

  return (
    <div className="modal-back" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Export</h3>
        {!result && (
          <>
            <div className="field">
              <div className="label">Format</div>
              <div className="segmented">
                <button className={opts.format === 'mp4' ? 'on' : ''} disabled={busy} onClick={() => set('format', 'mp4')}>
                  MP4 video
                </button>
                <button className={opts.format === 'gif' ? 'on' : ''} disabled={busy} onClick={() => set('format', 'gif')}>
                  GIF
                </button>
              </div>
            </div>
            <div className="field">
              <div className="label">Resolution</div>
              <div className="segmented">
                {([720, 1080, 1440, 2160] as const).map((h) => (
                  <button key={h} className={opts.height === h ? 'on' : ''} disabled={busy || (opts.format === 'gif' && h > 720)} onClick={() => set('height', h)}>
                    {h === 2160 ? '4K' : `${h}p`}
                  </button>
                ))}
              </div>
            </div>
            {opts.format === 'mp4' && (
              <>
                <div className="field">
                  <div className="label">Frame rate</div>
                  <div className="segmented">
                    {([30, 60] as const).map((f) => (
                      <button key={f} className={opts.fps === f ? 'on' : ''} disabled={busy} onClick={() => set('fps', f)}>
                        {f} fps
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <div className="label">Quality</div>
                  <div className="segmented">
                    {(['standard', 'high', 'max'] as const).map((q) => (
                      <button key={q} className={opts.quality === q ? 'on' : ''} disabled={busy} onClick={() => set('quality', q)}>
                        {q[0].toUpperCase() + q.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {busy && (
              <div style={{ marginTop: 8 }}>
                <div className="label" style={{ marginBottom: 6 }}>
                  <span>{progress.phase === 'render' ? 'Rendering frames…' : opts.format === 'gif' ? 'Creating GIF…' : 'Adding audio…'}</span>
                  <span className="value">{Math.round(pct * 100)}%</span>
                </div>
                <div className="progress">
                  <div style={{ width: `${pct * 100}%` }} />
                </div>
              </div>
            )}
            {error && <p style={{ color: '#ff8a82' }}>{error}</p>}
            <div className="modal-actions">
              {busy ? (
                <button className="btn" onClick={() => abort.current?.abort()}>
                  Cancel
                </button>
              ) : (
                <>
                  <button className="btn" onClick={onClose}>
                    Close
                  </button>
                  <button className="btn primary" onClick={start}>
                    <Icon.download size={15} /> Export
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {result && (
          <>
            <p className="muted" style={{ wordBreak: 'break-all' }}>
              Saved to <b style={{ color: 'var(--text)' }}>{result}</b>
            </p>
            <div className="modal-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => api.openPath(result)}>
                <Icon.play size={13} /> Open
              </button>
              <button className="btn" onClick={() => api.showInFolder(result)}>
                <Icon.folder size={14} /> Show in folder
              </button>
              <button className="btn" onClick={() => api.copyFile(result)}>
                <Icon.copy size={14} /> Copy file
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
