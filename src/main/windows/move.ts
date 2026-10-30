// 다른 앱 창 옮기기 (맥: 손쉬운 사용 API, 윈도우: SetWindowPos). 못 쓰면 null.
import { createMacMover } from './move-mac'
import { createWinMover } from './move-win'

export interface Mover {
  /** 지금 창을 옮길 수 있는지 (맥: 손쉬운 사용 권한) */
  canMove(): boolean
  /** 창 왼쪽 위를 화면 좌표(DIP)로 옮긴다. from = 지금 창 자리(창 찾기용). 실패하면 false */
  move(id: number, pid: number, x: number, y: number, from?: { x: number; y: number; w: number; h: number }): boolean
  /** 닫힌 창의 캐시를 비운다 */
  forget(id: number): void
}

let mover: Mover | null | undefined

export function getMover(): Mover | null {
  if (mover !== undefined) return mover
  mover = null
  try {
    if (process.platform === 'darwin') mover = createMacMover()
    else if (process.platform === 'win32') mover = createWinMover()
  } catch (err) {
    console.warn('[move] 창을 옮길 수 없어요:', (err as Error)?.message ?? err)
  }
  return mover
}
