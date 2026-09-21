import { Timer } from 'three'
import { clamp } from './math'

/**
 * Drives one callback per animation frame with a clamped delta time.
 * The upper clamp stops a tab that was hidden for a minute from teleporting the world when it wakes.
 * The lower clamp guards the first frame, whose timestamp can predate the timer's start.
 */
export class GameLoop {
  private readonly timer = new Timer()
  private readonly maxDelta = 1 / 30
  private readonly onFrame: (dt: number) => void

  constructor(onFrame: (dt: number) => void) {
    this.onFrame = onFrame
    this.timer.connect(document)
  }

  /** Pass to renderer.setAnimationLoop. */
  readonly tick = (timestamp: number): void => {
    this.timer.update(timestamp)
    this.onFrame(clamp(this.timer.getDelta(), 0, this.maxDelta))
  }

  dispose(): void {
    this.timer.disconnect()
  }
}
