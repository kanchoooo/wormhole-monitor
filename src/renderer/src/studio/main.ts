// 스튜디오(숨은 창): 영상 두 가지를 만든다.
//  · 도트 영상: 메인이 기록해 둔 프레임을 1080×1920 세로로 다시 그린다. 창은 상자로만 그려서 내 화면 내용은 담기지 않는다.
//    골인 직전은 슬로모션.
//  · 실화면 영상: 녹화하는 동안 실제 화면을 받아 세로로 잘라(움직이는 쪽을 따라감) 녹화한다.
// 효과음은 스피커로 내지 않고 영상 소리 트랙에만 넣는다.
import type { Clip, FramePacket, LiveStart, StudioDone } from '@shared/types'
import { Synth } from '@/common/sound'
import { loadFont, Painter } from '@/overlay/painter'

const api = window.studioApi
const W = 1080
const H = 1920
const SLOW = 0.35

interface Rec {
  stop(): Promise<{ data: Uint8Array; ext: 'mp4' | 'webm' }>
}

function startRecorder(cv: HTMLCanvasElement, synth: Synth | null): Rec {
  const stream = cv.captureStream(30)
  const audio = synth?.stream()
  if (audio) for (const tr of audio.getAudioTracks()) stream.addTrack(tr)
  const types = audio
    ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 10_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (ev) => {
    if (ev.data.size) chunks.push(ev.data)
  }
  const stopped = new Promise<void>((res) => (rec.onstop = () => res()))
  rec.start(500)
  return {
    async stop() {
      rec.stop()
      await stopped
      for (const tr of stream.getTracks()) tr.stop()
      const type = rec.mimeType || mime
      const blob = new Blob(chunks, { type })
      return { data: new Uint8Array(await blob.arrayBuffer()), ext: type.includes('mp4') ? 'mp4' : 'webm' }
    }
  }
}

function makeCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  document.body.appendChild(cv)
  return cv
}

const frame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r))

// ───────── 도트 영상 ─────────

const queue: Clip[] = []
let busy = false

/** 따라갈 장난감 위치 (없으면 null) */
function itemAt(f: FramePacket, id: number | null): [number, number] | null {
  if (id === null) return null
  for (let i = 0; i < f.items.length; i += 6) if (f.items[i] === id) return [f.items[i + 2], f.items[i + 3]]
  return null
}

const FOLLOW_H = 1140 // 따라갈 때 화면 높이(px) → 약 1.7배 확대
const ease = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k))

async function renderClip(clip: Clip): Promise<void> {
  await loadFont()
  const cv = makeCanvas()
  const ctx = cv.getContext('2d')!
  const synth = clip.sound ? new Synth(false) : null
  const view = clip.view
  const painter = new Painter(ctx, view, clip.dot, { backdrop: true, debug: false, chrome: false })
  const frames = clip.frames
  const S = frames[0].t
  const E = frames[frames.length - 1].t
  const G = clip.goalAt
  const slow = (t: number): boolean => G !== null && t > G - 900 && t < G + 250

  // 처음 0.7초는 코스 전체 (장난감이 지나간 곳 + 골인 자리 + 웜홀)
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
    const p = itemAt(f, clip.follow)
    if (p) add(p[0], p[1])
  }
  if (clip.goal) add(clip.goal.x, clip.goal.y)
  for (const p of frames[0].f.portals) add(p.x, p.y)
  if (!Number.isFinite(x0)) add(view.x + view.w / 2, view.y + view.h / 2)
  const fit = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 40, h: Math.max(FOLLOW_H, Math.min(3200, Math.max(y1 - y0 + 500, ((x1 - x0 + 300) * 16) / 9))) }
  const cam = { ...fit }
  let follow = { x: fit.x, y: fit.y }

  let strokesAt = -1
  const setStrokes = (t: number): void => {
    let k = -1
    for (let i = 0; i < clip.strokes.length; i++) if (clip.strokes[i].t <= t) k = i
    if (k !== strokesAt && k >= 0) {
      strokesAt = k
      painter.setStrokes(clip.strokes[k].strokes)
    }
  }
  const draw = (f: FramePacket, src: number, rate: number, vt: number): void => {
    // 카메라: 코스 전체 → 장난감 따라가기 → 골인하면 컵으로
    const p = itemAt(f, clip.follow)
    const afterGoal = G !== null && src >= G
    const target = afterGoal && clip.goal ? { x: clip.goal.x, y: clip.goal.y - 60 } : p ? { x: p[0], y: p[1] } : follow
    // 웜홀로 순간이동하면 카메라도 바로 (컷)
    if (Math.hypot(target.x - follow.x, target.y - follow.y) > 420) follow = { ...target }
    else {
      follow.x += (target.x - follow.x) * 0.12
      follow.y += (target.y - follow.y) * 0.12
    }
    const k = ease((vt - 0.7) / 0.7)
    const wantH = afterGoal ? FOLLOW_H * 0.85 : FOLLOW_H
    cam.x = fit.x + (follow.x - fit.x) * k
    cam.y = fit.y + (follow.y - fit.y) * k
    cam.h = fit.h + (wantH - fit.h) * k
    const z = H / cam.h
    const cw = (cam.h * 9) / 16
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#2c2457'
    ctx.fillRect(0, 0, W, H)
    ctx.imageSmoothingEnabled = false
    ctx.setTransform(z, 0, 0, z, -(cam.x - cw / 2 - view.x) * z, -(cam.y - cam.h / 2 - view.y) * z)
    painter.draw(f, src, rate)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    // 위: 이름표, 아래: 슬로모션 표시
    painter.label('🌀 웜홀 모니터', W / 2, 90, '#ffffff', 3)
    if (rate < 1) painter.label('슬로모션', W / 2, H - 120, '#ffd23f', 2.5)
  }
  setStrokes(S)
  draw(frames[0].f, S, 1, 0)
  const rec = startRecorder(cv, synth)
  let src = S
  let vt = 0
  let i = 0
  let last = await frame()
  try {
    while (src < E + 300) {
      const now = await frame()
      const dt = Math.min(50, now - last)
      last = now
      vt += dt / 1000
      const rate = slow(src) ? SLOW : 1
      src += dt * rate
      while (i + 1 < frames.length && frames[i + 1].t <= src) {
        i++
        for (const e of frames[i].f.fx) {
          painter.fx(e, frames[i].t)
          synth?.play(e)
        }
      }
      setStrokes(src)
      draw(frames[i].f, src, rate, vt)
    }
    const out = await rec.stop()
    api.done({ id: clip.id, kind: 'dot', ...out })
  } catch (err) {
    api.done({ id: clip.id, kind: 'dot', data: null, ext: 'mp4', error: String(err) })
  } finally {
    synth?.close()
    cv.remove()
  }
}

async function pump(): Promise<void> {
  if (busy) return
  busy = true
  while (queue.length) await renderClip(queue.shift()!)
  busy = false
}

api.onClip((c) => {
  queue.push(c)
  void pump()
})

// ───────── 실화면 영상 ─────────

interface Live {
  id: string
  video: HTMLVideoElement
  cv: HTMLCanvasElement
  rec: Rec
  synth: Synth | null
  bounds: LiveStart['bounds']
  cx: number
  last: FramePacket | null
  prev: Map<number, [number, number]>
  target: number
  stopping: boolean
}
let live: Live | null = null

api.onLiveStart(async (s) => {
  if (live) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: s.sourceId, maxFrameRate: 30 } } as unknown as MediaTrackConstraints
    })
    const video = document.createElement('video')
    video.muted = true
    video.srcObject = stream
    document.body.appendChild(video)
    await video.play()
    const cv = makeCanvas()
    const synth = s.sound ? new Synth(false) : null
    const b = s.bounds
    live = { id: s.id, video, cv, rec: startRecorder(cv, synth), synth, bounds: b, cx: b.x + b.w / 2, last: null, prev: new Map(), target: b.x + b.w / 2, stopping: false }
    void liveLoop()
  } catch (err) {
    api.done({ id: s.id, kind: 'screen', data: null, ext: 'mp4', error: String(err) })
  }
})

/** 따라갈 곳: 움직이는 장난감들 가운데 → 없으면 커서 */
function actionX(f: FramePacket, prev: Map<number, [number, number]>): number | null {
  let sx = 0
  let n = 0
  const it = f.items
  for (let i = 0; i < it.length; i += 6) {
    const p = prev.get(it[i])
    if (p && Math.hypot(it[i + 2] - p[0], it[i + 3] - p[1]) > 1.5) {
      sx += it[i + 2]
      n++
    }
  }
  prev.clear()
  for (let i = 0; i < it.length; i += 6) prev.set(it[i], [it[i + 2], it[i + 3]])
  if (n) return sx / n
  return f.ui?.cursor.x ?? null
}

api.onLiveFrame((f) => {
  if (!live) return
  live.last = f
  const x = actionX(f, live.prev)
  if (x !== null) live.target = x
  for (const e of f.fx) live.synth?.play(e)
})

async function liveLoop(): Promise<void> {
  const L = live
  if (!L) return
  const ctx = L.cv.getContext('2d')!
  while (live === L && !L.stopping) {
    await frame()
    const b = L.bounds
    // 화면 높이를 그대로 쓰는 9:16 창 (세로 모니터면 위아래가 남는다)
    const cw = Math.min(b.w, (b.h * 9) / 16)
    const ch = Math.min(b.h, (cw * 16) / 9)
    L.cx += (L.target - L.cx) * 0.06
    L.cx = Math.max(b.x + cw / 2, Math.min(b.x + b.w - cw / 2, L.cx))
    const k = L.video.videoWidth / b.w || 1
    const sx = (L.cx - cw / 2 - b.x) * k
    const sy = ((b.h - ch) / 2) * k
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
    const dh = (ch / cw) * W
    ctx.drawImage(L.video, sx, sy, cw * k, ch * k, 0, (H - dh) / 2, W, dh)
  }
}

api.onLiveStop(async () => {
  const L = live
  if (!L || L.stopping) return
  L.stopping = true
  try {
    const out = await L.rec.stop()
    api.done({ id: L.id, kind: 'screen', ...out })
  } catch (err) {
    api.done({ id: L.id, kind: 'screen', data: null, ext: 'mp4', error: String(err) } satisfies StudioDone)
  } finally {
    for (const tr of (L.video.srcObject as MediaStream | null)?.getTracks() ?? []) tr.stop()
    L.video.remove()
    L.cv.remove()
    L.synth?.close()
    live = null
  }
})

api.ready()
