// 공구함: 도구 고르기·설정·정리. 상태는 메인이 갖고 있고 여기는 보여 주기만 한다.
import { CHALLENGES } from '@shared/courses'
import { DRAW_MATERIALS, ITEM_KINDS, ITEMS, MATERIALS, STRUCTURE_KINDS, STRUCTURES } from '@shared/defs'
import { INSTAGRAM_HANDLE, type Tool, type ToolboxAction, type ToolboxState } from '@shared/types'
import { iconFor, materialSwatch, portalSprite, type Sprite } from '@/art/dots'
import galmuri from '@/assets/fonts/Galmuri11.woff2'
import galmuriBold from '@/assets/fonts/Galmuri11-Bold.woff2'
import './toolbox.css'

const api = window.toolboxApi
const app = document.getElementById('app')!
let state: ToolboxState | null = null

void new FontFace('WhGalmuri', `url(${galmuri})`).load().then((f) => document.fonts.add(f))
void new FontFace('WhGalmuri', `url(${galmuriBold})`, { weight: 'bold' }).load().then((f) => document.fonts.add(f))

const act = (a: ToolboxAction): void => api.act(a)
const same = (a: Tool, b: Tool): boolean => JSON.stringify(a) === JSON.stringify(b)

function iconCanvas(s: Sprite): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = s.canvas.width
  c.height = s.canvas.height
  c.getContext('2d')!.drawImage(s.canvas, 0, 0)
  c.className = 'ico'
  return c
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

function toolButton(tool: Tool, label: string, icon: HTMLElement | null, title = label): HTMLButtonElement {
  const b = el('button', 'tool')
  b.title = title
  if (icon) b.append(icon)
  b.append(el('span', 'lbl', label))
  if (state && same(state.tool, tool)) b.classList.add('on')
  b.onclick = () => act({ t: 'tool', tool: state && same(state.tool, tool) ? { t: 'none' } : tool })
  return b
}

function section(title: string, hint = ''): HTMLElement {
  const s = el('section')
  const h = el('h2', '', title)
  if (hint) h.append(el('small', '', hint))
  s.append(h)
  return s
}

function render(): void {
  const s = state
  if (!s) return
  app.innerHTML = ''

  const head = el('header')
  head.append(el('b', 'title', '🌀 웜홀 모니터'))
  const btns = el('div', 'head-btns')
  const hideAll = el('button', 'hide-all', '🙈 숨기기')
  hideAll.title = '놓은 것·장난감·공구함을 그대로 멈춰서 모두 숨겨요. ⌃⌥H 로 다시 보이기'
  hideAll.onclick = () => act({ t: 'hide-all' })
  const close = el('button', 'x', '–')
  close.title = '공구함만 닫기 (놓은 것은 화면에 그대로 · ⌃⌥W 로 다시 열기)'
  close.onclick = () => act({ t: 'hide' })
  btns.append(hideAll, close)
  head.append(btns)
  app.append(head)

  if (s.toast && Date.now() - s.toast.at < 5000) {
    const t = el('div', 'toast', s.toast.text)
    app.append(t)
    setTimeout(render, 5100 - (Date.now() - s.toast.at))
  }

  // 권한 안내
  if (!s.canMove && s.settings.pushWindows) {
    const warn = el('div', 'warn')
    warn.append(el('span', '', '창을 밀어내려면 손쉬운 사용 권한이 필요해요.'))
    const b = el('button', 'small', '권한 켜기')
    b.onclick = () => act({ t: 'open-accessibility' })
    warn.append(b)
    app.append(warn)
  }

  // 기본 도구
  const basic = section('도구', s.tool.t === 'none' ? '· 지금은 화면을 그대로 써요' : '· ESC 로 손 놓기')
  const row = el('div', 'grid g4')
  const off = el('button', 'tool' + (s.tool.t === 'none' ? ' on' : ''))
  off.append(el('span', 'big', '🖱'), el('span', 'lbl', '손 놓기'))
  off.title = '도구를 내려놓고 화면을 그대로 써요 (ESC)'
  off.onclick = () => act({ t: 'tool', tool: { t: 'none' } })
  row.append(off)
  row.append(toolButton({ t: 'portal' }, '웜홀', iconCanvas(portalSprite(0, 16, 2, 3, 1, false)), '두 번 클릭하면 한 쌍 · 끌면 나오는 방향'))
  const hand = el('span', 'big', '✋')
  row.append(toolButton({ t: 'hand' }, '손', hand, '장난감 잡아 던지기 · 구조물·웜홀 옮기기 · 노란 손잡이로 돌리기'))
  const er = el('span', 'big', '🧽')
  row.append(toolButton({ t: 'erase' }, '지우개', er, '문지르면 지워져요 (어느 도구든 오른쪽 클릭도 지우기)'))
  basic.append(row)
  app.append(basic)

  // 굴릴 것 · 쏠 것
  const roll = section('굴릴 것', '· 클릭 놓기 / 당겨서 쏘기')
  const rg = el('div', 'grid g6')
  for (const k of ITEM_KINDS) if (ITEMS[k].group === 'roll') rg.append(toolButton({ t: 'item', kind: k }, ITEMS[k].name, iconCanvas(iconFor(k, 2))))
  roll.append(rg)
  app.append(roll)

  const shoot = section('쏠 것', '· 화살은 창에 박혀요')
  const sg = el('div', 'grid g6')
  for (const k of ITEM_KINDS) if (ITEMS[k].group === 'shoot') sg.append(toolButton({ t: 'item', kind: k }, ITEMS[k].name, iconCanvas(iconFor(k, 2))))
  shoot.append(sg)
  app.append(shoot)

  const st = section('구조물', '· 끌면서 놓으면 기울어져요')
  const stg = el('div', 'grid g6')
  for (const k of STRUCTURE_KINDS) stg.append(toolButton({ t: 'struct', kind: k }, STRUCTURES[k].name, iconCanvas(iconFor(k, 2))))
  st.append(stg)
  app.append(st)

  const dr = section('그리기', '· 그린 선은 벽이 돼요')
  const dg = el('div', 'grid g4')
  for (const mat of DRAW_MATERIALS) dg.append(toolButton({ t: 'draw', mat }, MATERIALS[mat].name, iconCanvas(materialSwatch(mat, 2))))
  dr.append(dg)
  app.append(dr)

  // 고른 것
  if (s.sel) {
    const sel = section(s.sel.t === 'portal' ? '고른 웜홀' : '고른 구조물', '· 휠로 돌리기')
    const g = el('div', 'actions')
    if (s.sel.t === 'struct') {
      const small = el('button', 'small', '작게')
      small.onclick = () => act({ t: 'sel-scale', dir: -1 })
      const big = el('button', 'small', '크게')
      big.onclick = () => act({ t: 'sel-scale', dir: 1 })
      const pin = el('button', 'small' + (s.sel.pinned === false ? ' on' : ''), s.sel.pinned === false ? '📌 고정하기' : '📌 고정 풀기')
      pin.title = '고정을 풀면 구조물도 떨어지고 밀려요'
      pin.onclick = () => act({ t: 'sel-pin' })
      g.append(small, big, pin)
    }
    const del = el('button', 'small danger', s.sel.t === 'portal' ? '쌍 지우기' : '지우기')
    del.onclick = () => act({ t: 'sel-delete' })
    g.append(del)
    sel.append(g)
    app.append(sel)
  }

  // 코스
  const co = section('코스', '· 도전하거나 내 코스를 공유')
  const cg = el('div', 'grid g2')
  for (const ch of CHALLENGES) {
    const b = el('button', 'small chal' + (s.challenge === ch.id ? ' on' : ''), ch.name)
    b.title = ch.hint
    b.onclick = () => act({ t: 'course-load', id: ch.id })
    cg.append(b)
  }
  co.append(cg)
  const share = el('div', 'actions')
  share.style.marginTop = '4px'
  const copy = el('button', 'small', '📋 내 코스 복사')
  copy.title = '지금 놓은 웜홀·구조물·선을 코드로 복사 (장난감·창은 빼고)'
  copy.onclick = () => act({ t: 'course-copy' })
  const paste = el('button', 'small', '📥 코드 붙여넣기')
  paste.title = '친구가 보낸 WH1.… 코드를 복사한 뒤 누르세요'
  paste.onclick = () => act({ t: 'course-paste' })
  share.append(copy, paste)
  co.append(share)
  app.append(co)

  // 영상
  const vid = section('영상', '· 골인 장면을 세로 영상으로')
  const vg = el('div', 'actions')
  const rec = el('button', 'small' + (s.recordingSince ? ' rec' : ''), s.recordingSince ? `⏹ 멈추기 ${Math.floor((Date.now() - s.recordingSince) / 1000)}초` : '🎥 실화면 녹화')
  rec.title = '실제 화면을 녹화해요 (공구함은 안 찍혀요). 멈추면 같은 장면의 도트 영상도 같이 저장 · ⌃⌥R'
  rec.onclick = () => act({ t: 'record' })
  const folder = el('button', 'small', '📂 영상 폴더')
  folder.onclick = () => act({ t: 'open-videos' })
  vg.append(rec, folder)
  if (s.rendering) vg.append(el('span', 'dim', '도트 영상 만드는 중…'))
  vid.append(vg)
  if (s.screenPerm === 'denied') {
    const warn = el('div', 'warn')
    warn.append(el('span', '', '실화면 녹화는 화면 기록 권한이 필요해요.'))
    const b = el('button', 'small', '권한 켜기')
    b.onclick = () => act({ t: 'open-screen-permission' })
    warn.append(b)
    vid.append(warn)
  }
  const vt = el('div', 'toggles')
  vt.style.marginTop = '4px'
  const vtog = (label: string, on: boolean, patch: (v: boolean) => ToolboxAction): void => {
    const l = el('label', 'tog')
    const c = el('input')
    c.type = 'checkbox'
    c.checked = on
    c.onchange = () => act(patch(c.checked))
    l.append(c, el('span', '', label))
    vt.append(l)
  }
  vtog('골인하면 도트 영상 자동 저장', s.settings.autoClip, (v) => ({ t: 'settings', patch: { autoClip: v } }))
  vtog('녹화는 골인 2초 뒤 자동으로 멈춤', s.settings.stopOnGoal, (v) => ({ t: 'settings', patch: { stopOnGoal: v } }))
  vid.append(vt)
  app.append(vid)
  if (s.recordingSince) setTimeout(render, 1000)

  // 동작
  const ac = section('정리')
  const ag = el('div', 'actions')
  const btn = (label: string, a: ToolboxAction, enabled = true, title = ''): void => {
    const b = el('button', 'small', label)
    b.disabled = !enabled
    if (title) b.title = title
    b.onclick = () => act(a)
    ag.append(b)
  }
  btn('↶ 되돌리기', { t: 'undo' }, true, '⌘Z / Ctrl+Z')
  btn('↻ 다시 쏘기', { t: 'relaunch' }, s.canRelaunch, '마지막으로 쏜 그대로 한 번 더 (R)')
  btn(`🧹 장난감 치우기 ${s.counts.items || ''}`, { t: 'clear-items' }, s.counts.items > 0)
  btn('💥 전부 치우기', { t: 'clear-all' }, s.counts.items + s.counts.structs + s.counts.strokes + s.counts.portals > 0)
  btn(`🪟 창 원위치 ${s.counts.moved || ''}`, { t: 'restore-windows' }, s.counts.moved > 0, '밀려난 창을 처음 자리로')
  ac.append(ag)
  app.append(ac)

  // 설정
  const set = section('설정')
  const toggles = el('div', 'toggles')
  const tog = (label: string, on: boolean, patch: (v: boolean) => ToolboxAction): void => {
    const l = el('label', 'tog')
    const c = el('input')
    c.type = 'checkbox'
    c.checked = on
    c.onchange = () => act(patch(c.checked))
    l.append(c, el('span', '', label))
    toggles.append(l)
  }
  tog('커서도 웜홀 통과', s.settings.cursorWarp, (v) => ({ t: 'settings', patch: { cursorWarp: v } }))
  tog('창 밀어내기', s.settings.pushWindows, (v) => ({ t: 'settings', patch: { pushWindows: v } }))
  tog('소리', s.settings.sound, (v) => ({ t: 'settings', patch: { sound: v } }))
  const pv = el('div', 'seg')
  pv.append(el('span', '', '궤적 미리보기'))
  for (const [v, label] of [
    ['full', '전체'],
    ['short', '앞만'],
    ['off', '끔']
  ] as const) {
    const b = el('button', 'small' + (s.settings.preview === v ? ' on' : ''), label)
    b.onclick = () => act({ t: 'settings', patch: { preview: v } })
    pv.append(b)
  }
  const dotSeg = el('div', 'seg')
  dotSeg.append(el('span', '', '도트 크기'))
  for (const v of [2, 3, 4]) {
    const b = el('button', 'small' + (s.settings.dot === v ? ' on' : ''), `${v}`)
    b.onclick = () => act({ t: 'settings', patch: { dot: v } })
    dotSeg.append(b)
  }
  set.append(toggles, pv, dotSeg)
  app.append(set)

  const more = el('div', 'more')
  more.append(el('div', 'more-msg', `인스타 ${INSTAGRAM_HANDLE} 팔로우하면 새로 나온 재밌는 앱을 바로바로 해볼 수 있어요!`))
  const mb = el('div', 'actions')
  const insta = el('button', 'small primary', '인스타그램 보기')
  insta.onclick = () => act({ t: 'instagram' })
  const apps = el('button', 'small', '🧩 개발자의 다른 앱 보기')
  apps.onclick = () => act({ t: 'more-apps' })
  mb.append(insta, apps)
  more.append(mb)
  app.append(more)

  const foot = el('footer')
  foot.append(el('span', '', '오른쪽 클릭 = 지우기 · 휠 = 돌리기 · ⌃⌥H 숨기기'))
  const q = el('button', 'link', `종료 v${s.version}`)
  q.onclick = () => act({ t: 'quit' })
  foot.append(q)
  app.append(foot)
}

api.onState((s) => {
  state = s
  render()
})
api.ready()
