// Thin Win32 bindings (via koffi) for window enumeration, monitor handles and cursor state.
// All coordinates are physical pixels: Electron makes the process per-monitor DPI aware.
import koffi from 'koffi'
import type { CursorKind, Rect } from '@shared/types'

const user32 = koffi.load('user32.dll')
const dwmapi = koffi.load('dwmapi.dll')
const kernel32 = koffi.load('kernel32.dll')

koffi.alias('HANDLE_T', 'intptr_t')

const RECT = koffi.struct('SR_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
const POINT = koffi.struct('SR_POINT', { x: 'int32', y: 'int32' })
const CURSORINFO = koffi.struct('SR_CURSORINFO', {
  cbSize: 'uint32',
  flags: 'uint32',
  hCursor: 'HANDLE_T',
  ptScreenPos: POINT
})
const MONITORINFO = koffi.struct('SR_MONITORINFO', {
  cbSize: 'uint32',
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: 'uint32'
})

const EnumWindowsProc = koffi.proto('bool __stdcall SR_EnumWindowsProc(HANDLE_T hwnd, intptr_t lParam)')

const EnumWindows = user32.func('bool __stdcall EnumWindows(SR_EnumWindowsProc *cb, intptr_t lParam)')
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(HANDLE_T hwnd)')
const IsIconic = user32.func('bool __stdcall IsIconic(HANDLE_T hwnd)')
const IsWindow = user32.func('bool __stdcall IsWindow(HANDLE_T hwnd)')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(HANDLE_T hwnd, _Out_ uint16_t *buf, int max)')
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(HANDLE_T hwnd)')
const GetClassNameW = user32.func('int __stdcall GetClassNameW(HANDLE_T hwnd, _Out_ uint16_t *buf, int max)')
const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(HANDLE_T hwnd, int index)')
const GetAncestor = user32.func('HANDLE_T __stdcall GetAncestor(HANDLE_T hwnd, uint32_t flags)')
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(HANDLE_T hwnd, _Out_ SR_RECT *rect)')
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(HANDLE_T hwnd, _Out_ uint32_t *pid)')
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(HANDLE_T hwnd)')
const GetCursorInfo = user32.func('bool __stdcall GetCursorInfo(_Inout_ SR_CURSORINFO *info)')
const LoadCursorW = user32.func('HANDLE_T __stdcall LoadCursorW(HANDLE_T hInstance, intptr_t id)')
const MonitorFromPoint = user32.func('HANDLE_T __stdcall MonitorFromPoint(SR_POINT pt, uint32_t flags)')
const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(HANDLE_T hmon, _Inout_ SR_MONITORINFO *info)')
const DwmGetWindowAttribute = dwmapi.func(
  'int32_t __stdcall DwmGetWindowAttribute(HANDLE_T hwnd, uint32_t attr, _Out_ void *value, uint32_t size)'
)
const OpenProcess = kernel32.func('HANDLE_T __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)')
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(HANDLE_T h)')
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(HANDLE_T h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'
)

const GWL_STYLE = -16
const GWL_EXSTYLE = -20
const WS_EX_TOOLWINDOW = 0x80
const WS_EX_NOACTIVATE = 0x08000000
const WS_CHILD = 0x40000000
const GA_ROOTOWNER = 3
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
const MONITOR_DEFAULTTONEAREST = 2
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

function utf16(buf: Uint16Array, len: number): string {
  return String.fromCharCode(...buf.subarray(0, Math.max(0, len)))
}

function windowText(hwnd: number): string {
  const len = GetWindowTextLengthW(hwnd)
  if (len <= 0) return ''
  const buf = new Uint16Array(len + 1)
  return utf16(buf, GetWindowTextW(hwnd, buf, len + 1))
}

function className(hwnd: number): string {
  const buf = new Uint16Array(256)
  return utf16(buf, GetClassNameW(hwnd, buf, 256))
}

function exeName(hwnd: number): string {
  const pid = [0]
  GetWindowThreadProcessId(hwnd, pid)
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0])
  if (!h) return ''
  try {
    const buf = new Uint16Array(1024)
    const size = [1024]
    if (!QueryFullProcessImageNameW(h, 0, buf, size)) return ''
    const full = utf16(buf, size[0])
    return full.split('\\').pop() ?? ''
  } finally {
    CloseHandle(h)
  }
}

function isCloaked(hwnd: number): boolean {
  const out = Buffer.alloc(4)
  return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out, 4) === 0 && out.readUInt32LE(0) !== 0
}

/** Visible window bounds without the invisible resize border/shadow. */
export function windowBounds(hwnd: number): Rect | null {
  const out = Buffer.alloc(16)
  let r: { left: number; top: number; right: number; bottom: number }
  if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out, 16) === 0) {
    r = { left: out.readInt32LE(0), top: out.readInt32LE(4), right: out.readInt32LE(8), bottom: out.readInt32LE(12) }
  } else {
    const rect = {} as typeof r
    if (!GetWindowRect(hwnd, rect)) return null
    r = rect
  }
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }
}

export function isWindowAlive(hwnd: number): boolean {
  return IsWindow(hwnd)
}

export function focusWindow(hwnd: number): void {
  SetForegroundWindow(hwnd)
}

export interface RawWindow {
  hwnd: number
  title: string
  exe: string
  bounds: Rect
}

/** Top-level, user-facing windows in Z-order (same filter as the Alt+Tab list). */
export function listWindows(excludePid = process.pid): RawWindow[] {
  const result: RawWindow[] = []
  EnumWindows((hwnd: number) => {
    if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return true
    const style = Number(GetWindowLongPtrW(hwnd, GWL_STYLE))
    const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE))
    if (style & WS_CHILD || ex & WS_EX_TOOLWINDOW || ex & WS_EX_NOACTIVATE) return true
    if (GetAncestor(hwnd, GA_ROOTOWNER) !== hwnd) return true
    if (isCloaked(hwnd)) return true
    const title = windowText(hwnd)
    if (!title) return true
    const cls = className(hwnd)
    if (cls === 'Progman' || cls === 'WorkerW' || cls === 'Shell_TrayWnd') return true
    const pid = [0]
    GetWindowThreadProcessId(hwnd, pid)
    if (pid[0] === excludePid) return true
    const bounds = windowBounds(hwnd)
    if (!bounds || bounds.width < 50 || bounds.height < 50) return true
    result.push({ hwnd, title, exe: exeName(hwnd), bounds })
    return true
  }, 0)
  return result
}

export interface MonitorHandle {
  hmonitor: number
  bounds: Rect
}

export function monitorAt(x: number, y: number): MonitorHandle {
  const hmonitor = MonitorFromPoint({ x: Math.round(x), y: Math.round(y) }, MONITOR_DEFAULTTONEAREST)
  const info = { cbSize: koffi.sizeof(MONITORINFO), rcMonitor: {}, rcWork: {}, dwFlags: 0 } as unknown as {
    cbSize: number
    rcMonitor: { left: number; top: number; right: number; bottom: number }
  }
  GetMonitorInfoW(hmonitor, info)
  const r = info.rcMonitor
  return { hmonitor, bounds: { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top } }
}

// Standard system cursors, resolved once, used to classify the current cursor handle.
const IDC: Record<number, CursorKind> = {
  32512: 'arrow',
  32513: 'ibeam',
  32514: 'wait',
  32650: 'wait',
  32515: 'cross',
  32649: 'hand',
  32646: 'move',
  32645: 'ns',
  32644: 'ew',
  32642: 'nwse',
  32643: 'nesw',
  32648: 'no'
}
const cursorHandles = new Map<number, CursorKind>()
for (const [id, kind] of Object.entries(IDC)) {
  const h = LoadCursorW(0, Number(id))
  if (h) cursorHandles.set(Number(h), kind)
}

export interface CursorState {
  x: number
  y: number
  visible: boolean
  kind: CursorKind
}

export function cursorState(): CursorState | null {
  const info = { cbSize: koffi.sizeof(CURSORINFO), flags: 0, hCursor: 0, ptScreenPos: { x: 0, y: 0 } }
  if (!GetCursorInfo(info)) return null
  return {
    x: info.ptScreenPos.x,
    y: info.ptScreenPos.y,
    visible: (info.flags & 1) !== 0,
    kind: cursorHandles.get(Number(info.hCursor)) ?? 'arrow'
  }
}
