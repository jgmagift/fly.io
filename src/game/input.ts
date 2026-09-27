import { clamp } from './math'

const LEFT_KEYS = ['ArrowLeft', 'KeyA']
const RIGHT_KEYS = ['ArrowRight', 'KeyD']
const CONFIRM_KEYS = ['Space', 'Enter']
const GAME_KEYS = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...CONFIRM_KEYS, 'Escape', 'KeyM', 'KeyC'])

/** Button slots in the standard WebXR controller layout, which Quest Touch controllers use. */
const XR_BUTTON = { trigger: 0, grip: 1, aOrX: 4, bOrY: 5 } as const
const XR_DEADZONE = 0.15
/** A thumbstick flick past FIRE steps a menu once, and must come back inside REARM before it can fire again. */
const XR_FLICK_FIRE = 0.65
const XR_FLICK_REARM = 0.3

interface XRPadState {
  buttons: boolean[]
  flickArmed: boolean
}

/** Haptics on XR gamepads are not in the DOM typings yet, so describe just the part we use. */
interface HapticGamepad {
  hapticActuators?: ReadonlyArray<{ pulse?: (value: number, duration: number) => Promise<boolean> }>
}

/**
 * Input from keyboard, touch and VR controllers.
 * Steering is held state: arrow keys or A / D, holding the left or right half of the screen,
 * or a VR thumbstick, which is analog. Menus use one-shot presses, read through the consume
 * methods, which clear what they return.
 */
export class Input {
  /** True on devices whose primary pointer is a finger, so the HUD can show touch hints. */
  readonly isTouchDevice = window.matchMedia('(pointer: coarse)').matches
  /** Set once the player has touched the screen, so hints can be hidden. */
  touched = false

  private readonly keysDown = new Set<string>()
  /** Fresh presses nobody has consumed yet: keyboard codes, plus XR* names for VR buttons. */
  private readonly pressed = new Set<string>()
  private tapped = false
  /** Active touch pointers and which side of the screen each one is holding. */
  private readonly touchSides = new Map<number, -1 | 1>()
  private readonly surface: HTMLElement
  /** Analog steering from VR thumbsticks, already dead-zoned. */
  private xrSteer = 0
  private readonly xrPads = new Map<XRInputSource, XRPadState>()
  private readonly xrSources: XRInputSource[] = []

  constructor(surface: HTMLElement) {
    this.surface = surface
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.clear)
    surface.addEventListener('pointerdown', this.onPointerDown)
    surface.addEventListener('pointermove', this.onPointerMove)
    surface.addEventListener('pointerup', this.onPointerEnd)
    surface.addEventListener('pointercancel', this.onPointerEnd)
    surface.addEventListener('contextmenu', preventDefault)
  }

  /** -1 for full left, +1 for full right, 0 for none. */
  get steer(): number {
    const left = LEFT_KEYS.some((key) => this.keysDown.has(key)) ? 1 : 0
    const right = RIGHT_KEYS.some((key) => this.keysDown.has(key)) ? 1 : 0
    let touch = 0
    for (const side of this.touchSides.values()) touch += side
    return clamp(right - left + touch + this.xrSteer, -1, 1)
  }

  /** True if any of these was freshly pressed. */
  consumeKey(...codes: string[]): boolean {
    let found = false
    for (const code of codes) found = this.pressed.delete(code) || found
    return found
  }

  /** A fresh Space, Enter, click, tap, VR trigger or A / X. */
  consumeConfirm(): boolean {
    const tapped = this.tapped
    this.tapped = false
    return this.consumeKey(...CONFIRM_KEYS, 'XRConfirm') || tapped
  }

  /** A fresh left or right press or thumbstick flick, as -1 or +1, for stepping through menu choices. */
  consumeStep(): number {
    const left = this.consumeKey(...LEFT_KEYS, 'XRLeft') ? 1 : 0
    const right = this.consumeKey(...RIGHT_KEYS, 'XRRight') ? 1 : 0
    return right - left
  }

  /** Forget unconsumed presses. Call on every screen change so old presses never leak into the next screen. */
  clearPresses(): void {
    this.pressed.clear()
    this.tapped = false
  }

  /**
   * Read VR controllers. Call once per frame with the active session, or null outside VR.
   * Fresh button presses become one-shot presses: trigger or A / X confirms, B / Y changes camera,
   * grip goes back, and a thumbstick flick steps through menus. Buttons already held when a
   * controller first appears are ignored, so the click that entered VR cannot also start a run.
   */
  pollXR(session: XRSession | null): void {
    this.xrSteer = 0
    this.xrSources.length = 0
    if (!session) {
      this.xrPads.clear()
      return
    }
    let stick = 0
    const sources = session.inputSources
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]!
      const pad = source.gamepad
      if (!pad) continue
      this.xrSources.push(source)
      const x = pad.axes[2] ?? pad.axes[0] ?? 0
      if (Math.abs(x) > Math.abs(stick)) stick = x
      const buttons = pad.buttons.map((button) => button.pressed)

      const state = this.xrPads.get(source)
      if (!state) {
        this.xrPads.set(source, { buttons, flickArmed: Math.abs(x) < XR_FLICK_REARM })
        continue
      }
      const fresh = (index: number) => buttons[index] === true && state.buttons[index] !== true
      if (fresh(XR_BUTTON.trigger) || fresh(XR_BUTTON.aOrX)) this.pressed.add('XRConfirm')
      if (fresh(XR_BUTTON.bOrY)) this.pressed.add('XRCamera')
      if (fresh(XR_BUTTON.grip)) this.pressed.add('XRBack')
      state.buttons = buttons

      if (state.flickArmed && Math.abs(x) > XR_FLICK_FIRE) {
        this.pressed.add(x < 0 ? 'XRLeft' : 'XRRight')
        state.flickArmed = false
      } else if (!state.flickArmed && Math.abs(x) < XR_FLICK_REARM) {
        state.flickArmed = true
      }
    }
    const magnitude = Math.abs(stick)
    this.xrSteer = magnitude < XR_DEADZONE ? 0 : (Math.sign(stick) * (magnitude - XR_DEADZONE)) / (1 - XR_DEADZONE)
  }

  /** Buzz every VR controller. `intensity` is 0 to 1. Does nothing outside VR or without haptics. */
  pulse(intensity: number, milliseconds: number): void {
    for (const source of this.xrSources) {
      const pad = source.gamepad as unknown as HapticGamepad | null
      pad?.hapticActuators?.[0]?.pulse?.(intensity, milliseconds)?.catch(() => undefined)
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.clear)
    this.surface.removeEventListener('pointerdown', this.onPointerDown)
    this.surface.removeEventListener('pointermove', this.onPointerMove)
    this.surface.removeEventListener('pointerup', this.onPointerEnd)
    this.surface.removeEventListener('pointercancel', this.onPointerEnd)
    this.surface.removeEventListener('contextmenu', preventDefault)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!GAME_KEYS.has(event.code)) return
    event.preventDefault()
    this.keysDown.add(event.code)
    if (!event.repeat) this.pressed.add(event.code)
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.code)
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    // Mouse clicks steer too, which makes desktop testing of the touch path easy.
    event.preventDefault()
    this.touched = true
    this.tapped = true
    this.surface.setPointerCapture(event.pointerId)
    this.touchSides.set(event.pointerId, sideOf(event, this.surface))
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    // Sliding a finger across the middle switches direction without lifting.
    if (this.touchSides.has(event.pointerId)) {
      this.touchSides.set(event.pointerId, sideOf(event, this.surface))
    }
  }

  private readonly onPointerEnd = (event: PointerEvent): void => {
    this.touchSides.delete(event.pointerId)
  }

  private readonly clear = (): void => {
    this.keysDown.clear()
    this.touchSides.clear()
  }
}

function sideOf(event: PointerEvent, surface: HTMLElement): -1 | 1 {
  return event.clientX < surface.clientWidth / 2 ? -1 : 1
}

function preventDefault(event: Event): void {
  event.preventDefault()
}
