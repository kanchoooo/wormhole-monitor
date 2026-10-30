// 장면 저장: 엔진 프레임을 30fps 로 25초치 기록해 두었다가
//  · 골인하면 그 장면(던진 때부터 골인 2.5초 뒤까지)을 도트 영상으로 (설정: autoClip)
//  · 실화면 녹화 중이면 실제 화면 영상 + 같은 구간의 도트 영상 두 개를 같이 저장한다.
// 영상은 숨은 스튜디오 창(renderer/studio)이 만들고, 여기서 파일로 저장한다.
import { app, BrowserWindow, desktopCapturer, ipcMain, type Display } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Clip, FramePacket, LogFrame, Rect, Settings, StrokeView, StudioDone } from '@shared/types'
import { loadRenderer, preloadPath } from './env'

const KEEP_MS = 25_000
const AFTER_GOAL = 2500
const MAX_CLIP = 14_000
const LIVE_MAX = 90_000

interface Job {
  stamp: string
  want: Set<'dot' | 'screen'>
  saved: string[]
}

export class Recorder {
  private log: LogFrame[] = []
  private strokeLog: { t: number; strokes: StrokeView[] }[] = []
  private strokesVersion = -1
  private lastPush = 0
  private studio: BrowserWindow | null = null
  private studioReady: Promise<void> | null = null
  private jobs = new Map<string, Job>()
  private clipUntil = 0
  live: { id: string; since: number; bounds: Rect; stopTimer: NodeJS.Timeout | null; maxTimer: NodeJS.Timeout } | null = null
  rendering = 0
  lastSaved: string | null = null
  onChange: (() => void) | null = null
  onSaved: ((files: string[]) => void) | null = null
  /** 녹화 시작·끝 (오버레이 도구 표시·공구함 화면 캡처 막기) */
  onLive: ((on: boolean) => void) | null = null

  constructor(
    private settings: () => Settings,
    private outDir = join(app.getPath('videos'), '웜홀 모니터')
  ) {
    ipcMain.on('studio:done', (_e, d: StudioDone) => this.done(d))
  }

  // ───────── 기록 ─────────

  /** 엔진이 보내는 전체 프레임 (60Hz → 30fps 로 줄여 기록) */
  push(f: FramePacket, strokesVersion: number, strokes: () => StrokeView[]): void {
    const now = Date.now()
    if (strokesVersion !== this.strokesVersion) {
      this.strokesVersion = strokesVersion
      this.strokeLog.push({ t: now, strokes: strokes() })
    }
    // 효과가 있는 프레임은 꼭 남긴다 (소리·입자가 빠지지 않게)
    if (now - this.lastPush < 30 && !f.fx.length) return
    this.lastPush = now
    const last = this.log[this.log.length - 1]
    if (last && now - last.t < 30 && f.fx.length) {
      // 바로 앞 프레임에 효과를 합친다
      last.f.fx.push(...f.fx)
    } else this.log.push({ t: now, f: { ...f, ui: f.ui ? { ...f.ui, hover: null, sel: null, erase: 0 } : null } })
    while (this.log.length && now - this.log[0].t > KEEP_MS) this.log.shift()
    // 지금 선을 남기고 오래된 것은 지운다
    while (this.strokeLog.length > 1 && now - this.strokeLog[1].t > KEEP_MS) this.strokeLog.shift()
    if (this.live) this.studio?.webContents.send('studio:live-frame', f)
    for (const e of f.fx) if (e.t === 'goal') this.onGoal(now, e.id, e.age)
  }

  private onGoal(now: number, itemId: number, age: number): void {
    if (process.env.WH_LOG === '1') console.log(`[recorder] 골인 (장난감 ${itemId}, ${age.toFixed(1)}초 전 던짐)`)
    if (this.live) {
      if (this.settings().stopOnGoal && !this.live.stopTimer) this.live.stopTimer = setTimeout(() => this.stopLive(), AFTER_GOAL)
      return
    }
    if (!this.settings().autoClip || now < this.clipUntil) return
    const from = Math.max(now - age * 1000 - 800, now - MAX_CLIP + AFTER_GOAL)
    this.clipUntil = now + AFTER_GOAL
    setTimeout(() => this.makeClip(from, now + AFTER_GOAL, now, itemId, new Set(['dot'])), AFTER_GOAL + 100)
  }

  // ───────── 도트 영상 ─────────

  private makeClip(from: number, to: number, goalAt: number | null, itemId: number | null, want: Set<'dot' | 'screen'>, id = stampId(from)): void {
    const frames = this.log.filter((l) => l.t >= from && l.t <= to)
    if (frames.length < 10) return
    const strokes = this.strokeLog.filter((s, i) => s.t <= to && (i === this.strokeLog.length - 1 || this.strokeLog[i + 1].t >= from))
    const goalFx = frames.flatMap((l) => l.f.fx).find((e) => e.t === 'goal')
    const clip: Clip = {
      id,
      frames,
      strokes,
      view: this.bounds(frames),
      follow: itemId,
      goal: goalFx ? { x: goalFx.x, y: goalFx.y } : null,
      goalAt,
      dot: this.settings().dot,
      sound: this.settings().sound
    }
    if (!this.jobs.has(id)) this.jobs.set(id, { stamp: id, want, saved: [] })
    this.rendering++
    this.onChange?.()
    void this.ensureStudio().then(() => this.studio?.webContents.send('studio:clip', clip))
  }

  /** 그릴 영역: 구간 안의 장난감·웜홀·구조물·창을 모두 담는 사각형 (+여백) */
  private bounds(frames: LogFrame[]): Rect {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    const add = (x: number, y: number): void => {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
    for (const { f } of frames) {
      for (let i = 0; i < f.items.length; i += 6) add(f.items[i + 2], f.items[i + 3])
      for (const p of f.portals) add(p.x, p.y)
      for (const st of f.structs) add(st.x, st.y)
      for (const w of f.wins ?? []) {
        add(w.x, w.y)
        add(w.x + w.w, w.y + w.h)
      }
    }
    if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 1080, h: 1920 }
    const M = 700
    const r = { x: x0 - M, y: y0 - M, w: x1 - x0 + 2 * M, h: y1 - y0 + 2 * M }
    // 너무 크면 (멀리 날아간 것) 가운데만
    if (r.w > 6000) r.x += (r.w - 6000) / 2
    if (r.h > 5000) r.y += (r.h - 5000) / 2
    r.w = Math.min(r.w, 6000)
    r.h = Math.min(r.h, 5000)
    return r
  }

  // ───────── 실화면 녹화 ─────────

  async startLive(display: Display): Promise<string | null> {
    if (this.live) return null
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!src) return '녹화할 화면을 찾지 못했어요'
    await this.ensureStudio()
    const now = Date.now()
    const id = stampId(now)
    const b = display.bounds
    const bounds = { x: b.x, y: b.y, w: b.width, h: b.height }
    this.live = { id, since: now, bounds, stopTimer: null, maxTimer: setTimeout(() => this.stopLive(), LIVE_MAX) }
    this.jobs.set(id, { stamp: id, want: new Set(['screen', 'dot']), saved: [] })
    this.studio!.webContents.send('studio:live-start', { id, sourceId: src.id, bounds, sound: this.settings().sound })
    this.onLive?.(true)
    this.onChange?.()
    return null
  }

  stopLive(): void {
    const L = this.live
    if (!L) return
    if (L.stopTimer) clearTimeout(L.stopTimer)
    clearTimeout(L.maxTimer)
    this.live = null
    this.studio?.webContents.send('studio:live-stop')
    this.onLive?.(false)
    // 같은 구간의 도트 영상 (최대 14초)
    const now = Date.now()
    const goal = [...this.log].reverse().find((l) => l.t >= L.since && l.f.fx.some((e) => e.t === 'goal'))
    const goalFx = goal?.f.fx.find((e) => e.t === 'goal')
    this.makeClip(Math.max(L.since, now - MAX_CLIP), now, goal?.t ?? null, goalFx && goalFx.t === 'goal' ? goalFx.id : null, new Set(['screen', 'dot']), L.id)
    this.onChange?.()
  }

  // ───────── 저장 ─────────

  private done(d: StudioDone): void {
    if (d.kind === 'dot') this.rendering = Math.max(0, this.rendering - 1)
    if (process.env.WH_LOG === '1') console.log(`[recorder] ${d.kind} 완료 ${d.data?.byteLength ?? 0}바이트 ${d.ext} ${d.error ?? ''}`)
    const job = this.jobs.get(d.id)
    if (d.data && d.data.byteLength > 1000) {
      try {
        mkdirSync(this.outDir, { recursive: true })
        const file = join(this.outDir, `웜홀-${d.id}-${d.kind === 'dot' ? '도트' : '화면'}.${d.ext}`)
        writeFileSync(file, Buffer.from(d.data))
        this.lastSaved = file
        job?.saved.push(file)
      } catch (err) {
        console.error('[recorder] 저장 실패', err)
      }
    } else if (d.error) console.warn(`[recorder] ${d.kind} 영상 실패:`, d.error)
    if (job) {
      job.want.delete(d.kind)
      if (!job.want.size) {
        this.jobs.delete(d.id)
        if (job.saved.length) this.onSaved?.(job.saved)
      }
    }
    this.onChange?.()
  }

  private ensureStudio(): Promise<void> {
    if (this.studio && !this.studio.isDestroyed() && this.studioReady) return this.studioReady
    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 320,
      webPreferences: { preload: preloadPath('studio'), sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false }
    })
    win.webContents.setFrameRate(60)
    this.studio = win
    this.studioReady = new Promise((res) => ipcMain.once('studio:ready', () => res()))
    loadRenderer(win, 'studio')
    return this.studioReady
  }

  destroy(): void {
    if (this.studio && !this.studio.isDestroyed()) this.studio.destroy()
  }
}

function stampId(t: number): string {
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
