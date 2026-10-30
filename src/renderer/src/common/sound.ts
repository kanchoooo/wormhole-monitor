// 효과음: WebAudio 로 그 자리에서 합성한다 (8비트 느낌, 파일 없음)
import type { Fx } from '@shared/types'

let ac: AudioContext | null = null
let master: GainNode | null = null
let enabled = true
let volume = 0.6
let noiseBuf: AudioBuffer | null = null
/** 부딪힘 소리가 너무 많으면 거른다 */
let hitTimes: number[] = []

function ctx(): AudioContext | null {
  if (!enabled) return null
  if (!ac) {
    ac = new AudioContext()
    master = ac.createGain()
    master.gain.value = volume * 0.5
    master.connect(ac.destination)
  }
  if (ac.state === 'suspended') void ac.resume()
  return ac
}

export function setSound(on: boolean, vol: number): void {
  enabled = on
  volume = vol
  if (master) master.gain.value = vol * 0.5
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0): void {
  const a = ctx()
  if (!a || !master) return
  const t = a.currentTime + delay
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(f0, t)
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + dur + 0.02)
}

function noise(dur: number, gain: number, freq: number, delay = 0): void {
  const a = ctx()
  if (!a || !master) return
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const t = a.currentTime + delay
  const s = a.createBufferSource()
  s.buffer = noiseBuf
  const f = a.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.setValueAtTime(freq, t)
  f.frequency.exponentialRampToValueAtTime(80, t + dur)
  const g = a.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  s.connect(f).connect(g).connect(master)
  s.start(t)
  s.stop(t + dur + 0.02)
}

export function play(e: Fx): void {
  if (!enabled) return
  switch (e.t) {
    case 'hit': {
      const now = performance.now()
      hitTimes = hitTimes.filter((t) => now - t < 1000)
      if (hitTimes.length > 14) return
      hitTimes.push(now)
      const v = 0.08 + e.v * 0.35
      const heavy = e.k === 'bowling' || e.k === 'watermelon'
      if (e.m === 'window') tone('triangle', heavy ? 110 : 180, 60, 0.12, v)
      else if (e.m === 'metal') tone('square', 1400 + Math.random() * 300, 900, 0.09, v * 0.5)
      else if (e.m === 'rubber') tone('sine', 220, 520, 0.14, v)
      else if (e.m === 'ice') tone('sine', 2200, 1600, 0.06, v * 0.5)
      else if (e.m === 'glue') noise(0.08, v * 0.6, 600)
      else if (e.k === 'pingpong') tone('square', 1800, 1500, 0.03, v * 0.6)
      else tone('triangle', heavy ? 140 : 500 + Math.random() * 120, heavy ? 70 : 260, 0.07, v)
      break
    }
    case 'warp':
      tone('sine', 300, 1400, 0.18, 0.12)
      tone('square', 1400, 300, 0.12, 0.04, 0.05)
      break
    case 'cursor-warp':
      tone('sine', 900, 1800, 0.1, 0.06)
      break
    case 'stick':
      noise(0.05, 0.4, 2400)
      tone('triangle', 220, 90, 0.12, 0.25)
      break
    case 'kick':
      tone('square', e.k === 'spring' ? 180 : 600, e.k === 'spring' ? 900 : 1200, 0.12, 0.12)
      break
    case 'bell':
      tone('sine', 1320, 1318, 0.9, 0.18)
      tone('sine', 2640, 2630, 0.5, 0.06)
      break
    case 'splat':
      noise(0.25, 0.5, 1800)
      tone('sine', 200, 60, 0.2, 0.2)
      break
    case 'boom':
      noise(0.7, 0.9, 1200)
      tone('sine', 120, 30, 0.6, 0.6)
      break
    case 'goal': {
      // 빠밤!
      const notes = [523, 659, 784, 1047]
      notes.forEach((f, i) => tone('square', f, f, 0.12, 0.1, i * 0.08))
      tone('square', 1047, 1047, 0.4, 0.1, 0.34)
      tone('triangle', 523, 523, 0.5, 0.12, 0.34)
      break
    }
  }
}
