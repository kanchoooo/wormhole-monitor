// 커서·마우스 버튼 읽기, 커서 순간이동. 도구를 쓰는 동안 입력은 메인이 직접 읽는다
// (윈도우에서는 포커스를 받지 않는 오버레이에 클릭이 오지 않으므로 — 비둘기 모니터와 같은 이유).
import koffi from 'koffi'
import { screen } from 'electron'

export interface Buttons {
  left: boolean
  right: boolean
}

export interface Input {
  /** 지금 눌려 있는 버튼 (아주 짧은 클릭도 한 번은 눌림으로 본다) */
  buttons(): Buttons
  /** 커서를 화면 좌표(DIP)로 옮긴다 */
  warp(x: number, y: number): boolean
}

export function createInput(): Input {
  try {
    if (process.platform === 'darwin') return macInput()
    if (process.platform === 'win32') return winInput()
  } catch (err) {
    console.warn('[input] 마우스를 읽을 수 없어요:', (err as Error)?.message ?? err)
  }
  return { buttons: () => ({ left: false, right: false }), warp: () => false }
}

function macInput(): Input {
  const objc = koffi.load('/usr/lib/libobjc.A.dylib')
  const CG = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
  const objc_getClass = objc.func('void *objc_getClass(const char *name)')
  const sel_registerName = objc.func('void *sel_registerName(const char *name)')
  const msgSend = objc.func('uint64_t objc_msgSend(void *self, void *op)')
  koffi.struct('WhCGPoint', { x: 'double', y: 'double' })
  const CGWarpMouseCursorPosition = CG.func('int32_t CGWarpMouseCursorPosition(WhCGPoint p)')
  const CGAssociateMouseAndMouseCursorPosition = CG.func('int32_t CGAssociateMouseAndMouseCursorPosition(int connected)')
  const NSEvent = objc_getClass('NSEvent')
  const sel = sel_registerName('pressedMouseButtons')
  if (!NSEvent || !sel) throw new Error('NSEvent 없음')
  return {
    buttons() {
      // 권한 없이 읽을 수 있는 현재 눌린 버튼 (bit0 = 왼쪽, bit1 = 오른쪽)
      const m = Number(msgSend(NSEvent, sel))
      return { left: (m & 1) !== 0, right: (m & 2) !== 0 }
    },
    warp(x, y) {
      const ok = CGWarpMouseCursorPosition({ x, y }) === 0
      // 순간이동 직후 0.25초 동안 마우스가 굳는 것을 없앤다
      CGAssociateMouseAndMouseCursorPosition(1)
      return ok
    }
  }
}

function winInput(): Input {
  const user32 = koffi.load('user32.dll')
  const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)')
  const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)')
  const SetCursorPos = user32.func('int __stdcall SetCursorPos(int x, int y)')
  const SM_SWAPBUTTON = 23
  // 가장 높은 비트: 지금 눌려 있음, 가장 낮은 비트: 지난 호출 이후 눌렸다 뗌
  const down = (vk: number): boolean => {
    const s = GetAsyncKeyState(vk) as number
    return (s & 0x8000) !== 0 || (s & 1) !== 0
  }
  return {
    buttons() {
      const swap = GetSystemMetrics(SM_SWAPBUTTON) !== 0
      return { left: down(swap ? 0x02 : 0x01), right: down(swap ? 0x01 : 0x02) }
    },
    warp(x, y) {
      const p = screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) })
      return !!SetCursorPos(p.x, p.y)
    }
  }
}
