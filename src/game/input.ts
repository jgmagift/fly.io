import { clamp } from './math'

const LEFT_KEYS = ['ArrowLeft', 'KeyA']
const RIGHT_KEYS = ['ArrowRight', 'KeyD']
const CONFIRM_KEYS = ['Space', 'Enter']
const GAME_KEYS = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...CONFIRM_KEYS, 'Escape', 'KeyM'])

/**
 * Input from keyboard and touch.
 * Steering is held state: arrow keys or A / D, or holding the left or right half of the screen.
 * Menus use one-shot presses, read through the consume methods, which clear what they return.
 */
export class Input {
  /** True on devices whose primary pointer is a finger, so the HUD can show touch hints. */
  readonly isTouchDevice = window.matchMedia('(pointer: coarse)').matches
  /** Set once the player has touched the screen, so hints can be hidden. */
  touched = false

  private readonly keysDown = new Set<string>()
  /** Fresh key presses nobody has consumed yet. */
  private readonly pressed = new Set<string>()
  private tapped = false
  /** Active touch pointers and which side of the screen each one is holding. */
  private readonly touchSides = new Map<number, -1 | 1>()
  private readonly surface: HTMLElement

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
    return clamp(right - left + touch, -1, 1)
  }

  /** True if any of these keys was freshly pressed. */
  consumeKey(...codes: string[]): boolean {
    let found = false
    for (const code of codes) found = this.pressed.delete(code) || found
    return found
  }

  /** A fresh Space, Enter, click or tap on the play surface. */
  consumeConfirm(): boolean {
    const tapped = this.tapped
    this.tapped = false
    return this.consumeKey(...CONFIRM_KEYS) || tapped
  }

  /** A fresh left or right press, as -1 or +1, for stepping through menu choices. */
  consumeStep(): number {
    const left = this.consumeKey(...LEFT_KEYS) ? 1 : 0
    const right = this.consumeKey(...RIGHT_KEYS) ? 1 : 0
    return right - left
  }

  /** Forget unconsumed presses. Call on every screen change so old presses never leak into the next screen. */
  clearPresses(): void {
    this.pressed.clear()
    this.tapped = false
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
