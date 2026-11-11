import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export function Countdown(): React.JSX.Element {
  const [n, setN] = useState(3)
  useEffect(() => {
    const timer = setInterval(() => {
      setN((v) => {
        if (v <= 1) {
          clearInterval(timer)
          // Let the overlay disappear before capture starts.
          setTimeout(() => api.countdownDone(), 60)
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])
  return <div className="countdown">{n > 0 && <div key={n}>{n}</div>}</div>
}
