import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty" style={{ userSelect: 'text' }}>
        <h3 style={{ color: 'var(--text)' }}>Something went wrong</h3>
        <pre style={{ whiteSpace: 'pre-wrap', textAlign: 'left', maxWidth: 720, margin: '0 auto' }}>{this.state.error.message}</pre>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
