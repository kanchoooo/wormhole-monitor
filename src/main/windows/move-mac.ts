// macOS: 손쉬운 사용(Accessibility) API 로 다른 앱 창을 옮긴다.
// CGWindowID(창 목록의 id) → AX 창 요소는 _AXUIElementGetWindow 로 찾는다 (Rectangle 등 창 관리 앱이 쓰는 방법).
// 권한이 없으면 조용히 실패한다 (index.ts 의 canMove() 로 먼저 확인).
import koffi from 'koffi'
import type { Mover } from './move'

const kCFStringEncodingUTF8 = 0x08000100
const kAXValueCGPointType = 1
const kAXErrorSuccess = 0
const kAXErrorInvalidUIElement = -25202
const kAXErrorCannotComplete = -25204

export function createMacMover(): Mover {
  const CF = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
  const AS = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
  koffi.struct('WhAXPoint', { x: 'double', y: 'double' })
  const CFStringCreateWithCString = CF.func('void *CFStringCreateWithCString(void *alloc, const char *s, uint32_t enc)')
  const CFArrayGetCount = CF.func('long CFArrayGetCount(void *arr)')
  const CFArrayGetValueAtIndex = CF.func('void *CFArrayGetValueAtIndex(void *arr, long idx)')
  const CFRetain = CF.func('void *CFRetain(void *ref)')
  const CFRelease = CF.func('void CFRelease(void *ref)')
  const AXIsProcessTrusted = AS.func('bool AXIsProcessTrusted()')
  const AXUIElementCreateApplication = AS.func('void *AXUIElementCreateApplication(int pid)')
  const AXUIElementSetMessagingTimeout = AS.func('int AXUIElementSetMessagingTimeout(void *el, float seconds)')
  const AXUIElementCopyAttributeValue = AS.func('int AXUIElementCopyAttributeValue(void *el, void *attr, _Out_ void **value)')
  const AXUIElementSetAttributeValue = AS.func('int AXUIElementSetAttributeValue(void *el, void *attr, void *value)')
  const AXValueCreate = AS.func('void *AXValueCreate(int type, WhAXPoint *value)')
  const AXUIElementGetWindow = AS.func('int _AXUIElementGetWindow(void *el, _Out_ uint32_t *wid)')
  const AXValueGetValue = AS.func('bool AXValueGetValue(void *value, int type, _Out_ WhAXPoint *out)')
  const CFStringGetCString = CF.func('bool CFStringGetCString(void *s, _Out_ uint8_t *buf, long size, uint32_t enc)')

  const str = (s: string): unknown => CFStringCreateWithCString(null, s, kCFStringEncodingUTF8)
  const A = { windows: str('AXWindows'), position: str('AXPosition'), size: str('AXSize'), role: str('AXRole') }
  const kAXValueCGSizeType = 2
  const strBuf = Buffer.alloc(64)

  /** 요소의 점·크기 값 (CGPoint·CGSize 모두 double 두 개) */
  function pair(el: unknown, attr: unknown, type: number): { x: number; y: number } | null {
    const out: unknown[] = [null]
    if (AXUIElementCopyAttributeValue(el, attr, out) !== kAXErrorSuccess || !out[0]) return null
    const v = { x: 0, y: 0 }
    const ok = AXValueGetValue(out[0], type, v)
    CFRelease(out[0])
    return ok ? v : null
  }

  function role(el: unknown): string {
    const out: unknown[] = [null]
    if (AXUIElementCopyAttributeValue(el, A.role, out) !== kAXErrorSuccess || !out[0]) return ''
    const ok = CFStringGetCString(out[0], strBuf, strBuf.length, kCFStringEncodingUTF8)
    CFRelease(out[0])
    return ok ? strBuf.toString('utf8').replace(/\0.*$/s, '') : ''
  }

  const apps = new Map<number, unknown>()
  const wins = new Map<number, unknown>()
  /** 응답 없는 앱은 잠깐 건너뛴다 (메인 스레드가 멈추지 않게) */
  const coolUntil = new Map<number, number>()

  function app(pid: number): unknown {
    let a = apps.get(pid)
    if (!a) {
      a = AXUIElementCreateApplication(pid)
      if (!a) return null
      // 응답 없는 앱 때문에 물리 루프가 멈추지 않도록 짧게
      AXUIElementSetMessagingTimeout(a, 0.08)
      apps.set(pid, a)
    }
    return a
  }

  /** 이 앱의 AX 창들을 훑어 CGWindowID → 요소 캐시를 채운다. id 를 못 얻으면 위치·크기가 같은 창으로 */
  function scan(pid: number, want?: { id: number; x: number; y: number; w: number; h: number }): void {
    const a = app(pid)
    if (!a) return
    const out: unknown[] = [null]
    if (AXUIElementCopyAttributeValue(a, A.windows, out) !== kAXErrorSuccess || !out[0]) return
    const arr = out[0]
    try {
      const n = Number(CFArrayGetCount(arr))
      const wid = [0]
      for (let i = 0; i < n; i++) {
        const el = CFArrayGetValueAtIndex(arr, i)
        if (!el || role(el) !== 'AXWindow') continue
        if (AXUIElementGetWindow(el, wid) === kAXErrorSuccess && wid[0]) {
          if (!wins.has(wid[0])) wins.set(wid[0], CFRetain(el))
          continue
        }
        if (!want || wins.has(want.id)) continue
        const p = pair(el, A.position, kAXValueCGPointType)
        const sz = pair(el, A.size, kAXValueCGSizeType)
        if (p && sz && Math.abs(p.x - want.x) < 3 && Math.abs(p.y - want.y) < 3 && Math.abs(sz.x - want.w) < 3 && Math.abs(sz.y - want.h) < 3) wins.set(want.id, CFRetain(el))
      }
    } finally {
      CFRelease(arr)
    }
  }

  function forget(id: number): void {
    const el = wins.get(id)
    if (el) CFRelease(el)
    wins.delete(id)
  }

  return {
    canMove: () => AXIsProcessTrusted(),
    move(id, pid, x, y, from) {
      const now = Date.now()
      if ((coolUntil.get(pid) ?? 0) > now) return false
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!wins.has(id)) scan(pid, from && { id, ...from })
        const el = wins.get(id)
        if (!el) return false
        const v = AXValueCreate(kAXValueCGPointType, { x: Math.round(x), y: Math.round(y) })
        const err = AXUIElementSetAttributeValue(el, A.position, v) as number
        CFRelease(v)
        if (err === kAXErrorSuccess) return true
        if (err === kAXErrorInvalidUIElement) {
          forget(id)
          continue
        }
        if (err === kAXErrorCannotComplete) coolUntil.set(pid, now + 3000)
        return false
      }
      return false
    },
    forget
  }
}
