// 오버레이: 메인이 60Hz 로 보내는 프레임을 도트로 그린다. 계산은 하지 않는다 (효과 입자만 여기서).
import type { FramePacket, OverlayInit, Settings } from '@shared/types'
import { speakers } from '@/common/sound'
import { loadFont, Painter } from './painter'

const api = window.overlayApi
const canvas = document.getElementById('stage') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
let painter: Painter | null = null
let frame: FramePacket | null = null
let soundOn = true
let dot = 3
let recording = false
void loadFont()

api.onInit((init: OverlayInit) => {
  const b = init.bounds
  canvas.width = b.w
  canvas.height = b.h
  canvas.style.width = `${b.w}px`
  canvas.style.height = `${b.h}px`
  dot = init.dot
  const opts = { backdrop: init.backdrop, debug: init.debug, chrome: !recording }
  if (!painter) painter = new Painter(ctx, b, dot, opts)
  else {
    painter.opts = opts
    painter.setDot(dot)
    painter.resize(b)
  }
})

api.onSettings((s: Settings) => {
  soundOn = s.sound
  speakers.set(s.sound, s.volume)
  dot = s.dot
  painter?.setDot(s.dot)
})

api.onRecording((on) => {
  recording = on
  if (painter) painter.opts.chrome = !on
})

api.onScene((s) => painter?.setStrokes(s.strokes))

api.onFrame((f) => {
  frame = f
  const now = performance.now()
  for (const e of f.fx) {
    if (soundOn) speakers.play(e)
    painter?.fx(e, now)
  }
})

window.addEventListener('wheel', (e) => api.wheel(e.deltaY), { passive: true })

function draw(now: number): void {
  requestAnimationFrame(draw)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  painter?.draw(frame, now)
}
requestAnimationFrame(draw)

api.ready()
