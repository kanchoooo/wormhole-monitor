import { BrowserWindow } from 'electron'
import { join } from 'path'

/**
 * 개발·테스트용 환경변수
 *  WH_SELFTEST=1        창 목록·창 옮기기 권한(koffi)을 한 번 확인해 출력하고 종료 (패키징 확인용)
 *  WH_LOG=1             렌더러 콘솔을 터미널로
 *  WH_NO_UPDATE=1       자동 업데이트 끄기
 *  WH_USERDATA=폴더     저장 위치를 바꾼다
 *  WH_SCRIPT=경로.json  자동 조작 [{ "at": ms, ... }] (테스트용, engine/script.ts)
 *  WH_SHOT_DIR=폴더     WH_SCRIPT 의 shot 저장 위치
 */
export const env = process.env

export function preloadPath(name: 'overlay' | 'toolbox' | 'studio'): string {
  return join(__dirname, `../preload/${name}.js`)
}

export function loadRenderer(win: BrowserWindow, page: 'overlay' | 'toolbox' | 'studio', o: { hash?: string; query?: Record<string, string> } = {}): void {
  const devUrl = env.ELECTRON_RENDERER_URL
  const q = o.query && Object.keys(o.query).length ? '?' + new URLSearchParams(o.query).toString() : ''
  if (devUrl) {
    void win.loadURL(`${devUrl}/${page}.html${q}${o.hash ? '#' + o.hash : ''}`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`), { hash: o.hash, query: o.query })
  }
}
