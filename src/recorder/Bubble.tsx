import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

export function Bubble({ deviceId }: { deviceId: string }): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [device, setDevice] = useState(deviceId)

  useEffect(() => api.on('bubble:device', (id: string) => setDevice(id)), [])

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    void navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: device }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (video.current) video.current.srcObject = s
      })
      .catch((err) => console.warn('camera preview failed', err))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [device])

  return (
    <div className="bubble">
      <video ref={video} autoPlay muted playsInline />
    </div>
  )
}
