// Minimal stroke icons (24x24 grid).
type P = { size?: number; className?: string }

function svg(children: React.ReactNode, { size = 16, className }: P): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  )
}

export const Icon = {
  monitor: (p: P = {}) => svg(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>, p),
  window: (p: P = {}) => svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></>, p),
  area: (p: P = {}) => svg(<><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><rect x="8" y="8" width="8" height="8" rx="1" /></>, p),
  mic: (p: P = {}) => svg(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>, p),
  speaker: (p: P = {}) => svg(<><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>, p),
  camera: (p: P = {}) => svg(<><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3z" /></>, p),
  close: (p: P = {}) => svg(<path d="M6 6l12 12M18 6 6 18" />, p),
  minus: (p: P = {}) => svg(<path d="M5 12h14" />, p),
  pause: (p: P = {}) => svg(<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>, p),
  play: (p: P = {}) => svg(<path d="M7 4.5v15l12-7.5z" fill="currentColor" />, p),
  stop: (p: P = {}) => svg(<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />, p),
  restart: (p: P = {}) => svg(<><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" /><path d="M4 4v4.6h4.6" /></>, p),
  trash: (p: P = {}) => svg(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>, p),
  plus: (p: P = {}) => svg(<path d="M12 5v14M5 12h14" />, p),
  zoom: (p: P = {}) => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4M11 8v6M8 11h6" /></>, p),
  scissors: (p: P = {}) => svg(<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></>, p),
  speed: (p: P = {}) => svg(<><path d="M12 14l4-4" /><path d="M3.3 16a9 9 0 1 1 17.4 0" /></>, p),
  blur: (p: P = {}) => svg(<><rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 3" /><circle cx="12" cy="12" r="3" /></>, p),
  undo: (p: P = {}) => svg(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>, p),
  redo: (p: P = {}) => svg(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>, p),
  download: (p: P = {}) => svg(<><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></>, p),
  folder: (p: P = {}) => svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />, p),
  copy: (p: P = {}) => svg(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>, p),
  cursor: (p: P = {}) => svg(<path d="m5 3 14 8-6 1.5L10 19z" />, p),
  image: (p: P = {}) => svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>, p),
  keyboard: (p: P = {}) => svg(<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>, p),
  sparkles: (p: P = {}) => svg(<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />, p),
  layers: (p: P = {}) => svg(<><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>, p),
  pencil: (p: P = {}) => svg(<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />, p),
  settings: (p: P = {}) => svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>, p),
  crop: (p: P = {}) => svg(<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" />, p)
}
