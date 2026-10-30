// 효과음: WebAudio 로 그 자리에서 합성한다 (8비트 느낌, 파일 없음)
// 스피커로 내보내거나(오버레이), 영상에 넣을 소리 트랙으로만 만들 수 있다(스튜디오).
import type { Fx } from '@shared/types'

export class Synth {
  private ac: AudioContext | null = null
  private master: GainNode | null = null
  private dest: MediaStreamAudioDestinationNode | null = null
  private noiseBuf: AudioBuffer | null = null
  /** 부딪힘 소리가 너무 많으면 거른다 */
  private hitTimes: number[] = []
  enabled = true
  private volume = 0.6

  constructor(private speakers = true) {}

  private ctx(): AudioContext | null {
    if (!this.enabled) return null
    if (!this.ac) {
      this.ac = new AudioContext()
      this.master = this.ac.createGain()
      this.master.gain.value = this.volume * 0.5
      if (this.speakers) this.master.connect(this.ac.destination)
      else {
        this.dest = this.ac.createMediaStreamDestination()
        this.master.connect(this.dest)
      }
    }
    if (this.ac.state === 'suspended') void this.ac.resume()
    return this.ac
  }

  /** 영상용 소리 트랙 (speakers=false 일 때) */
  stream(): MediaStream | null {
    this.ctx()
    return this.dest?.stream ?? null
  }

  set(on: boolean, vol: number): void {
    this.enabled = on
    this.volume = vol
    if (this.master) this.master.gain.value = vol * 0.5
  }

  close(): void {
    void this.ac?.close()
    this.ac = null
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0): void {
    const a = this.ctx()
    if (!a || !this.master) return
    const t = a.currentTime + delay
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private noise(dur: number, gain: number, freq: number, delay = 0): void {
    const a = this.ctx()
    if (!a || !this.master) return
    if (!this.noiseBuf) {
      this.noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
    const t = a.currentTime + delay
    const s = a.createBufferSource()
    s.buffer = this.noiseBuf
    const f = a.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(freq, t)
    f.frequency.exponentialRampToValueAtTime(80, t + dur)
    const g = a.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(f).connect(g).connect(this.master)
    s.start(t)
    s.stop(t + dur + 0.02)
  }

  play(e: Fx): void {
    if (!this.enabled) return
    switch (e.t) {
      case 'hit': {
        const now = performance.now()
        this.hitTimes = this.hitTimes.filter((t) => now - t < 1000)
        if (this.hitTimes.length > 14) return
        this.hitTimes.push(now)
        const v = 0.08 + e.v * 0.35
        const heavy = e.k === 'bowling' || e.k === 'watermelon'
        if (e.m === 'window') this.tone('triangle', heavy ? 110 : 180, 60, 0.12, v)
        else if (e.m === 'metal') this.tone('square', 1400 + Math.random() * 300, 900, 0.09, v * 0.5)
        else if (e.m === 'rubber') this.tone('sine', 220, 520, 0.14, v)
        else if (e.m === 'ice') this.tone('sine', 2200, 1600, 0.06, v * 0.5)
        else if (e.m === 'glue') this.noise(0.08, v * 0.6, 600)
        else if (e.k === 'pingpong') this.tone('square', 1800, 1500, 0.03, v * 0.6)
        else this.tone('triangle', heavy ? 140 : 500 + Math.random() * 120, heavy ? 70 : 260, 0.07, v)
        break
      }
      case 'warp':
        this.tone('sine', 300, 1400, 0.18, 0.12)
        this.tone('square', 1400, 300, 0.12, 0.04, 0.05)
        break
      case 'cursor-warp':
        this.tone('sine', 900, 1800, 0.1, 0.06)
        break
      case 'stick':
        this.noise(0.05, 0.4, 2400)
        this.tone('triangle', 220, 90, 0.12, 0.25)
        break
      case 'kick':
        this.tone('square', e.k === 'spring' ? 180 : 600, e.k === 'spring' ? 900 : 1200, 0.12, 0.12)
        break
      case 'bell':
        this.tone('sine', 1320, 1318, 0.9, 0.18)
        this.tone('sine', 2640, 2630, 0.5, 0.06)
        break
      case 'splat':
        this.noise(0.25, 0.5, 1800)
        this.tone('sine', 200, 60, 0.2, 0.2)
        break
      case 'boom':
        this.noise(0.7, 0.9, 1200)
        this.tone('sine', 120, 30, 0.6, 0.6)
        break
      case 'goal': {
        // 빠밤!
        const notes = [523, 659, 784, 1047]
        notes.forEach((f, i) => this.tone('square', f, f, 0.12, 0.1, i * 0.08))
        this.tone('square', 1047, 1047, 0.4, 0.1, 0.34)
        this.tone('triangle', 523, 523, 0.5, 0.12, 0.34)
        break
      }
    }
  }
}

/** 오버레이용 (스피커) */
export const speakers = new Synth(true)
