import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Drag {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function AreaSelect({ displayId }: { displayId: number }): React.JSX.Element {
  const [drag, setDrag] = useState<Drag | null>(null)
  const [down, setDown] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') api.areaDone(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rect = drag && {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0)
  }

  return (
    <div
      className="area"
      style={rect ? { background: 'transparent' } : undefined}
      onMouseDown={(e) => {
        setDown(true)
        setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })
      }}
      onMouseMove={(e) => down && setDrag((d) => d && { ...d, x1: e.clientX, y1: e.clientY })}
      onMouseUp={() => {
        setDown(false)
        if (rect && rect.width > 40 && rect.height > 40) api.areaDone({ displayId, rect })
        else setDrag(null)
      }}
    >
      {rect && (
        <>
          <div className="sel" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />
          <div className="size" style={{ left: rect.x, top: Math.max(0, rect.y - 22) }}>
            {Math.round(rect.width * devicePixelRatio)} × {Math.round(rect.height * devicePixelRatio)}
          </div>
        </>
      )}
      {!down && <div className="hint">Drag to select an area · Esc to cancel</div>}
    </div>
  )
}
