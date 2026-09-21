const MUTE_KEY = 'fly.muted'

/** Drop a file with this name into the project's public/ folder to replace the built-in music. */
const CUSTOM_MUSIC_URL = 'music.mp3'

const BPM = 112
const STEP_SECONDS = 60 / BPM / 4
const STEPS_PER_BAR = 16

/** One bar each: A minor, F, C, G. `bass` is the root, `tones` are the notes the arpeggio walks over. */
const PROGRESSION = [
  { bass: 110.0, tones: [220.0, 261.63, 329.63, 440.0] },
  { bass: 87.31, tones: [174.61, 220.0, 261.63, 349.23] },
  { bass: 130.81, tones: [261.63, 329.63, 392.0, 523.25] },
  { bass: 98.0, tones: [196.0, 246.94, 293.66, 392.0] },
] as const
/** Which chord tone plays on each eighth note of the bar. */
const ARP_PATTERN = [0, 1, 2, 3, 2, 3, 1, 2] as const

interface Nodes {
  ctx: AudioContext
  master: GainNode
  music: GainNode
  noise: AudioBuffer
  engineGain: GainNode
  engineFilter: BiquadFilterNode
  engineTone: OscillatorNode
  enginePan: StereoPannerNode
}

interface ToneOptions {
  type?: OscillatorType
  gain?: number
  slideTo?: number
  /** Absolute context time to start at. Defaults to now. */
  at?: number
  delay?: number
  out?: AudioNode
}

/**
 * Every sound is synthesised with the Web Audio API, so there are no audio files to load.
 * Browsers only allow sound after a user gesture, so nothing is created until the first key or tap.
 * The music is a small step sequencer: plucked arpeggio and bass always, drums only while flying.
 */
export class GameAudio {
  muted = loadMuted()
  private nodes: Nodes | null = null
  private step = 0
  private nextStepAt = 0
  /** True once a custom music file has loaded and replaced the sequencer. */
  private customMusic = false

  constructor() {
    window.addEventListener('pointerdown', this.unlock)
    window.addEventListener('keydown', this.unlock)
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0')
    } catch {
      // Not remembering the mute setting is harmless.
    }
    const nodes = this.nodes
    if (nodes) nodes.master.gain.setTargetAtTime(this.muted ? 0 : 1, nodes.ctx.currentTime, 0.05)
    return this.muted
  }

  /** Call every frame. `speedRatio` is 0 at starting speed and 1 at top speed. `subdued` ducks the music. */
  update(flying: boolean, subdued: boolean, speedRatio: number, steer: number): void {
    const nodes = this.nodes
    if (!nodes) return
    const now = nodes.ctx.currentTime
    nodes.engineGain.gain.setTargetAtTime(flying ? 0.1 + 0.08 * speedRatio : 0, now, 0.15)
    nodes.engineFilter.frequency.setTargetAtTime(350 + 900 * speedRatio + Math.abs(steer) * 250, now, 0.1)
    nodes.engineTone.frequency.setTargetAtTime(55 + 45 * speedRatio, now, 0.2)
    nodes.enginePan.pan.setTargetAtTime(steer * 0.35, now, 0.1)
    nodes.music.gain.setTargetAtTime(subdued ? 0.25 : 0.8, now, 0.4)

    if (this.customMusic) return
    // Schedule a little ahead of the clock so timing stays tight even when frames are late.
    if (this.nextStepAt < now - 0.5) this.nextStepAt = now + 0.05
    while (this.nextStepAt < now + 0.2) {
      this.scheduleStep(this.step, this.nextStepAt, flying)
      this.nextStepAt += STEP_SECONDS
      this.step += 1
    }
  }

  select(): void {
    this.tone(660, 0.07, { type: 'triangle', gain: 0.12 })
  }

  start(): void {
    this.tone(220, 0.35, { type: 'sawtooth', gain: 0.1, slideTo: 880 })
  }

  multiplierUp(): void {
    this.tone(523.25, 0.09, { type: 'triangle', gain: 0.14 })
    this.tone(783.99, 0.14, { type: 'triangle', gain: 0.14, delay: 0.08 })
  }

  crash(): void {
    this.burst(0.4, 0.5, 2400, 180)
    this.tone(130, 0.35, { gain: 0.45, slideTo: 38 })
  }

  gameOver(): void {
    this.tone(392, 0.3, { type: 'triangle', gain: 0.16, delay: 0.25 })
    this.tone(311.13, 0.3, { type: 'triangle', gain: 0.16, delay: 0.55 })
    this.tone(220, 0.8, { type: 'triangle', gain: 0.16, delay: 0.85 })
  }

  private readonly unlock = (): void => {
    if (!this.nodes) {
      this.nodes = this.build()
      void this.loadCustomMusic(this.nodes)
    }
    if (this.nodes.ctx.state === 'suspended') void this.nodes.ctx.resume()
    if (this.nodes.ctx.state === 'running') {
      window.removeEventListener('pointerdown', this.unlock)
      window.removeEventListener('keydown', this.unlock)
    }
  }

  private build(): Nodes {
    const ctx = new AudioContext()
    const master = ctx.createGain()
    master.gain.value = this.muted ? 0 : 1
    master.connect(ctx.destination)

    // Two seconds of white noise, looped for the wind and reused for crashes and hi-hats.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const samples = noise.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1

    // Engine: rushing wind (band-passed noise) plus a low drone, panned slightly into turns.
    const enginePan = ctx.createStereoPanner()
    enginePan.connect(master)
    const engineGain = ctx.createGain()
    engineGain.gain.value = 0
    engineGain.connect(enginePan)
    const engineFilter = ctx.createBiquadFilter()
    engineFilter.type = 'bandpass'
    engineFilter.frequency.value = 400
    engineFilter.Q.value = 0.8
    engineFilter.connect(engineGain)
    const wind = ctx.createBufferSource()
    wind.buffer = noise
    wind.loop = true
    wind.connect(engineFilter)
    wind.start()
    const droneFilter = ctx.createBiquadFilter()
    droneFilter.type = 'lowpass'
    droneFilter.frequency.value = 220
    const droneGain = ctx.createGain()
    droneGain.gain.value = 0.35
    droneFilter.connect(droneGain).connect(engineGain)
    const engineTone = ctx.createOscillator()
    engineTone.type = 'sawtooth'
    engineTone.frequency.value = 55
    engineTone.connect(droneFilter)
    engineTone.start()

    // Music bus with a dotted-eighth echo, which gives the plucks some space.
    const music = ctx.createGain()
    music.gain.value = 0
    music.connect(master)
    const echo = ctx.createDelay(1)
    echo.delayTime.value = STEP_SECONDS * 3
    const feedback = ctx.createGain()
    feedback.gain.value = 0.32
    const echoLevel = ctx.createGain()
    echoLevel.gain.value = 0.35
    music.connect(echo)
    echo.connect(feedback).connect(echo)
    echo.connect(echoLevel).connect(master)

    return { ctx, master, music, noise, engineGain, engineFilter, engineTone, enginePan }
  }

  /** If the project ships its own track, loop that and silence the sequencer. A missing file is normal. */
  private async loadCustomMusic(nodes: Nodes): Promise<void> {
    try {
      const response = await fetch(CUSTOM_MUSIC_URL)
      if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('audio')) return
      const buffer = await nodes.ctx.decodeAudioData(await response.arrayBuffer())
      const source = nodes.ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.connect(nodes.music)
      source.start()
      this.customMusic = true
    } catch {
      // No custom track, or it could not be decoded: keep the built-in music.
    }
  }

  private scheduleStep(step: number, at: number, flying: boolean): void {
    const nodes = this.nodes
    if (!nodes) return
    const inBar = step % STEPS_PER_BAR
    const chord = PROGRESSION[Math.floor(step / STEPS_PER_BAR) % PROGRESSION.length]!
    const out = nodes.music

    // Plucked arpeggio on every eighth note, an octave shimmer on the last bar of each phrase.
    if (inBar % 2 === 0) {
      const tone = chord.tones[ARP_PATTERN[inBar / 2]!]!
      this.tone(tone, 0.32, { type: 'triangle', gain: 0.11, at, out })
      if (Math.floor(step / STEPS_PER_BAR) % 4 === 3) this.tone(tone * 2, 0.2, { gain: 0.035, at, out })
    }
    // Bass on beats one and three, with a pickup before the next bar.
    if (inBar === 0 || inBar === 8) this.tone(chord.bass, 0.5, { type: 'sawtooth', gain: 0.07, at, out })
    if (inBar === 14) this.tone(chord.bass * 1.5, 0.2, { type: 'sawtooth', gain: 0.05, at, out })

    // Drums only during a run: kick on the beat, a quiet hat in between.
    if (!flying) return
    if (inBar % 4 === 0) this.tone(140, 0.16, { gain: 0.3, slideTo: 45, at, out })
    if (inBar % 4 === 2) this.burst(0.04, 0.05, 9000, 6000, at, out)
  }

  /** A single enveloped note, optionally sliding in pitch. */
  private tone(frequency: number, duration: number, options: ToneOptions = {}): void {
    const nodes = this.nodes
    if (!nodes) return
    const { type = 'sine', gain = 0.2, slideTo, delay = 0, out = nodes.master } = options
    const start = (options.at ?? nodes.ctx.currentTime) + delay
    const oscillator = nodes.ctx.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, start)
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration)
    const envelope = nodes.ctx.createGain()
    envelope.gain.setValueAtTime(0, start)
    envelope.gain.linearRampToValueAtTime(gain, start + 0.008)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(envelope).connect(out)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.05)
  }

  /** A burst of noise through a closing low-pass filter. */
  private burst(
    duration: number,
    gain: number,
    filterFrom: number,
    filterTo: number,
    at?: number,
    out?: AudioNode,
  ): void {
    const nodes = this.nodes
    if (!nodes) return
    const start = at ?? nodes.ctx.currentTime
    const source = nodes.ctx.createBufferSource()
    source.buffer = nodes.noise
    const filter = nodes.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(filterFrom, start)
    filter.frequency.exponentialRampToValueAtTime(filterTo, start + duration)
    const envelope = nodes.ctx.createGain()
    envelope.gain.setValueAtTime(gain, start)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(filter).connect(envelope).connect(out ?? nodes.master)
    source.start(start)
    source.stop(start + duration + 0.05)
  }
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}
