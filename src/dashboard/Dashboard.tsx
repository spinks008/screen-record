import { useEffect, useState } from 'react'
import type { ProjectSummary, Settings } from '@shared/types'
import { api, formatTime } from '../lib/api'
import { Icon } from '../lib/icons'

export function Dashboard(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null)
  const [name, setName] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  const load = (): void => void api.listProjects().then(setProjects)
  useEffect(() => {
    load()
    return api.on('projects:changed', load)
  }, [])

  return (
    <div className="dash">
      <div className="titlebar drag">
        <div className="brand">
          <span className="brand-mark" /> Screen Record
        </div>
      </div>
      <div className="dash-head">
        <div>
          <h1>Recordings</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            Record your screen, then polish it with automatic zooms, a smooth cursor and beautiful backgrounds.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShowSettings(true)}>
            <Icon.settings /> Settings
          </button>
          <button className="btn primary" onClick={() => api.openPicker()}>
            <span className="dot" style={{ color: '#ff6b62' }} /> New recording
          </button>
        </div>
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        {projects && projects.length === 0 && (
          <div className="hero-empty">
            <h2>No recordings yet</h2>
            <p>
              Press <span className="kbd">Ctrl</span> + <span className="kbd">Shift</span> + <span className="kbd">R</span> anywhere, or click{' '}
              <b>New recording</b>. Your clicks become smooth zooms automatically.
            </p>
          </div>
        )}
        <div className="grid">
          {projects?.map((p) => (
            <div key={p.id} className="card" onClick={() => api.openProject(p.id)}>
              <div className="card-thumb" style={p.thumbnail ? { backgroundImage: `url("${p.thumbnail}")` } : undefined}>
                <span className="card-dur">{formatTime(p.durationMs)}</span>
              </div>
              <div className="card-body">
                <div className="card-title">
                  <div title={p.name}>{p.name}</div>
                  <div>{new Date(p.createdAt).toLocaleString()}</div>
                </div>
                <button
                  className="btn ghost icon sm"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenaming(p)
                    setName(p.name)
                  }}
                >
                  <Icon.pencil size={14} />
                </button>
                <button
                  className="btn ghost icon sm"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirmDelete(p.name)) void api.deleteProject(p.id)
                  }}
                >
                  <Icon.trash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {renaming && (
        <div className="modal-back" onClick={() => setRenaming(null)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              void api.renameProject(renaming.id, name)
              setRenaming(null)
            }}
          >
            <h3>Rename recording</h3>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                Save
              </button>
            </div>
          </form>
        </div>
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}

let pendingDelete: string | null = null
/** Two-click delete (avoids blocking browser dialogs). */
function confirmDelete(name: string): boolean {
  if (pendingDelete === name) {
    pendingDelete = null
    return true
  }
  pendingDelete = name
  setTimeout(() => (pendingDelete = null), 2500)
  showToast(`Click delete again to remove “${name}”`)
  return false
}

function showToast(text: string): void {
  const el = document.createElement('div')
  el.textContent = text
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#252531',
    border: '1px solid #363645',
    padding: '8px 14px',
    borderRadius: '8px',
    zIndex: '100'
  })
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2500)
}

function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => void api.getSettings().then(setS), [])
  if (!s) return <div className="modal-back" />
  const update = (patch: Partial<Settings>): void => {
    setS({ ...s, ...patch })
    void api.setSettings(patch)
  }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        <div className="field">
          <label>Export folder</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" readOnly value={s.exportFolder ?? 'Videos\\Screen Record'} />
            <button className="btn" onClick={async () => setS(await api.chooseExportFolder())}>
              Change
            </button>
          </div>
        </div>
        <div className="field">
          <label>Default style preset for new recordings</label>
          <select className="select" value={s.defaultPresetId ?? ''} onChange={(e) => update({ defaultPresetId: e.target.value || null })}>
            <option value="">Built-in default</option>
            {s.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {s.presets.length > 0 && (
          <div className="field">
            <label>Saved presets</label>
            {s.presets.map((p) => (
              <div key={p.id} className="switch-row">
                <span>{p.name}</span>
                <button
                  className="btn ghost sm"
                  onClick={() =>
                    update({
                      presets: s.presets.filter((x) => x.id !== p.id),
                      defaultPresetId: s.defaultPresetId === p.id ? null : s.defaultPresetId
                    })
                  }
                >
                  <Icon.trash size={13} /> Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="field">
          <label>Shortcuts</label>
          <div className="muted">
            <span className="kbd">Ctrl+Shift+R</span> start / stop · <span className="kbd">Ctrl+Shift+P</span> pause / resume
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
