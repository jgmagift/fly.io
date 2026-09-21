import { PerspectiveCamera, Vector3 } from 'three'
import { CAMERA } from './constants'
import { approach } from './math'
import type { Ship } from './ship'

export type CameraMode = 'chase' | 'showcase'

const _target = new Vector3()

/**
 * Chase view: locked to the ship sideways, leaning a little into its bank, shaking on impact.
 * Showcase view: sways around the hovering ship for the menu.
 * Only the offsets blend between the two, so sideways tracking of the ship never lags.
 */
export class FollowCamera {
  readonly camera: PerspectiveCamera
  mode: CameraMode = 'showcase'
  /** Camera position and look-at point, both relative to the ship's ground position. */
  private readonly offset = new Vector3(0, CAMERA.showcaseHeight, CAMERA.showcaseRadius)
  private readonly look = new Vector3(0, CAMERA.showcaseLookY, 0)
  private shakeAmount = 0

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far)
  }

  /** Kick the camera. `amount` is 0 to 1. */
  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount)
  }

  update(dt: number, time: number, ship: Ship): void {
    if (this.mode === 'chase') {
      this.glide(this.offset, _target.set(0, CAMERA.offsetY, CAMERA.offsetZ), dt)
      this.glide(this.look, _target.set(0, CAMERA.lookAtY, CAMERA.lookAheadZ), dt)
    } else {
      const angle = Math.sin(time * CAMERA.showcaseSwingSpeed) * CAMERA.showcaseSwing
      const radius = CAMERA.showcaseRadius
      this.glide(this.offset, _target.set(Math.sin(angle) * radius, CAMERA.showcaseHeight, Math.cos(angle) * radius), dt)
      this.glide(this.look, _target.set(0, CAMERA.showcaseLookY, 0), dt)
    }

    this.shakeAmount = approach(this.shakeAmount, 0, CAMERA.shakeDecay, dt)
    const reach = this.shakeAmount * CAMERA.shakeDistance
    const jitterX = (Math.random() * 2 - 1) * reach
    const jitterY = (Math.random() * 2 - 1) * reach
    this.camera.position.set(ship.x + this.offset.x + jitterX, this.offset.y + jitterY, this.offset.z)
    this.camera.lookAt(ship.x + this.look.x, this.look.y, this.look.z)
    this.camera.rotateZ(ship.bank * CAMERA.bankFollow)
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  private glide(current: Vector3, target: Vector3, dt: number): void {
    current.set(
      approach(current.x, target.x, CAMERA.modeBlend, dt),
      approach(current.y, target.y, CAMERA.modeBlend, dt),
      approach(current.z, target.z, CAMERA.modeBlend, dt),
    )
  }
}
