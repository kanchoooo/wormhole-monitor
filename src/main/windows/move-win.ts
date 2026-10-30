// Windows: SetWindowPos 로 다른 앱 창을 옮긴다. 권한은 필요 없지만
// 관리자 권한으로 실행된 창(UIPI)은 옮길 수 없다 — 조용히 실패한다.
// 창 목록은 DWM 실제 테두리(그림자 제외) 기준이라, GetWindowRect 와의 차이만큼 보정한다.
import koffi from 'koffi'
import { screen } from 'electron'
import type { Mover } from './move'

const SWP_NOSIZE = 0x0001
const SWP_NOZORDER = 0x0004
const SWP_NOACTIVATE = 0x0010
const SWP_ASYNCWINDOWPOS = 0x4000
const DWMWA_EXTENDED_FRAME_BOUNDS = 9

export function createWinMover(): Mover {
  const user32 = koffi.load('user32.dll')
  const dwm = koffi.load('dwmapi.dll')
  koffi.struct('WhRECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' })
  // HWND 는 창 목록이 숫자로 주므로 intptr_t 로 받는다
  const SetWindowPos = user32.func('int __stdcall SetWindowPos(intptr_t hWnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)')
  const GetWindowRect = user32.func('int __stdcall GetWindowRect(intptr_t hWnd, _Out_ WhRECT *rect)')
  const IsWindow = user32.func('int __stdcall IsWindow(intptr_t hWnd)')
  const DwmGetWindowAttribute = dwm.func('int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attr, _Out_ uint8_t *pv, uint32_t cb)')
  const frame = Buffer.alloc(16)

  return {
    canMove: () => true,
    move(id, _pid, x, y) {
      if (!IsWindow(id)) return false
      const r = { left: 0, top: 0, right: 0, bottom: 0 }
      if (!GetWindowRect(id, r)) return false
      let dx = 0
      let dy = 0
      if (DwmGetWindowAttribute(id, DWMWA_EXTENDED_FRAME_BOUNDS, frame, 16) === 0) {
        dx = r.left - frame.readInt32LE(0)
        dy = r.top - frame.readInt32LE(4)
      }
      const p = screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) })
      return !!SetWindowPos(id, 0, p.x + dx, p.y + dy, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS)
    },
    forget() {}
  }
}
