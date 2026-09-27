import { Group, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { CAMERA, CAMERA_VIEWS, CAMERA_VIEW_ORDER, SHIP } from './constants'
import type { CameraView } from './constants'
import { approach } from './math'
import type { Ship } from './ship'

export type CameraMode = 'run' | 'showcase'

const VIEW_KEY = 'fly.camera'

const _target = new Vector3()
const _chasePosition = new Vector3()
const _chaseQuaternion = new Quaternion()
const _cockpitPosition = new Vector3()
const _cockpitQuaternion = new Quaternion()

/**
 * The camera and the rig it rides in.
 *
 * Flat screen: the rig stays at the origin and the camera is placed directly. Chase-style views sit
 * behind the ship, lean a little into its bank and shake on impact. The cockpit view rides on the
 * ship and rolls with it. Switching views glides smoothly.
 *
 * VR: the headset drives the camera, so only the rig moves. It jumps straight to each view and
 * never rolls or shakes, because a world that tilts or wobbles on its own makes people sick.
 */
export class FollowCamera {
  readonly rig = new Group()
  readonly camera: PerspectiveCamera
  mode: CameraMode = 'showcase'
  view: CameraView = loadView()
  private xr = false
  /** Chase-style eye position and aim point, both relative to the ship's ground position. */
  private readonly offset = new Vector3(0, CAMERA.showcaseHeight, CAMERA.showcaseRadius)
  private readonly look = new Vector3(0, CAMERA.showcaseLookY, 0)
  /** 0 is fully chase-style, 1 is fully in the cockpit. */
  private cockpitBlend = 0
  private fov: number = CAMERA.fov
  private shakeAmount = 0

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far)
    this.rig.add(this.camera)
  }

  /** Step to the next run view and remember it for next time. */
  cycleView(): CameraView {
    const next = (CAMERA_VIEW_ORDER.indexOf(this.view) + 1) % CAMERA_VIEW_ORDER.length
    this.view = CAMERA_VIEW_ORDER[next]!
    try {
      localStorage.setItem(VIEW_KEY, this.view)
    } catch {
      // Not remembering the view is harmless.
    }
    return this.view
  }

  setXR(active: boolean): void {
    this.xr = active
    this.shakeAmount = 0
    this.rig.position.set(0, 0, 0)
  }

  /** Kick the camera. `amount` is 0 to 1. Ignored in VR. */
  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount)
  }

  update(dt: number, time: number, ship: Ship): void {
    if (this.xr) this.placeRig(ship)
    else this.placeCamera(dt, time, ship)
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /** VR: put the player's eyes, which sit at the rig origin, on the current view's eye point. */
  private placeRig(ship: Ship): void {
    if (this.mode === 'showcase') {
      this.rig.position.set(0, CAMERA.vrShowcaseHeight, CAMERA.vrShowcaseBack)
    } else if (this.view === 'cockpit') {
      this.rig.position.set(ship.x + ship.cockpit.x, SHIP.hoverHeight + ship.cockpit.y, ship.cockpit.z)
    } else {
      const view = CAMERA_VIEWS[this.view]
      this.rig.position.set(ship.x, view.height, view.back)
    }
  }

  private placeCamera(dt: number, time: number, ship: Ship): void {
    const running = this.mode === 'run'
    if (running) {
      const view = CAMERA_VIEWS[this.view]
      this.glide(this.offset, _target.set(0, view.height, view.back), dt)
      this.glide(this.look, _target.set(0, view.lookY, view.lookAhead), dt)
    } else {
      const angle = Math.sin(time * CAMERA.showcaseSwingSpeed) * CAMERA.showcaseSwing
      const radius = CAMERA.showcaseRadius
      this.glide(this.offset, _target.set(Math.sin(angle) * radius, CAMERA.showcaseHeight, Math.cos(angle) * radius), dt)
      this.glide(this.look, _target.set(0, CAMERA.showcaseLookY, 0), dt)
    }
    const inCockpit = running && this.view === 'cockpit'
    this.cockpitBlend = approach(this.cockpitBlend, inCockpit ? 1 : 0, CAMERA.modeBlend, dt)
    this.fov = approach(this.fov, running ? CAMERA_VIEWS[this.view].fov : CAMERA.fov, CAMERA.modeBlend, dt)

    const camera = this.camera
    camera.position.set(ship.x + this.offset.x, this.offset.y, this.offset.z)
    camera.lookAt(ship.x + this.look.x, this.look.y, this.look.z)
    camera.rotateZ(ship.bank * CAMERA.bankFollow)

    if (this.cockpitBlend > 0.001) {
      _chasePosition.copy(camera.position)
      _chaseQuaternion.copy(camera.quaternion)
      ship.cockpitPose(_cockpitPosition, _cockpitQuaternion)
      camera.position.lerpVectors(_chasePosition, _cockpitPosition, this.cockpitBlend)
      camera.quaternion.slerpQuaternions(_chaseQuaternion, _cockpitQuaternion, this.cockpitBlend)
    }

    // Shake less in the cockpit, where the hull is right under the lens.
    this.shakeAmount = approach(this.shakeAmount, 0, CAMERA.shakeDecay, dt)
    const reach = this.shakeAmount * CAMERA.shakeDistance * (1 - 0.7 * this.cockpitBlend)
    camera.position.x += (Math.random() * 2 - 1) * reach
    camera.position.y += (Math.random() * 2 - 1) * reach

    // Re-applied every frame because a VR session leaves the headset's field of view behind.
    if (camera.fov !== this.fov) {
      camera.fov = this.fov
      camera.updateProjectionMatrix()
    }
  }

  private glide(current: Vector3, target: Vector3, dt: number): void {
    current.set(
      approach(current.x, target.x, CAMERA.modeBlend, dt),
      approach(current.y, target.y, CAMERA.modeBlend, dt),
      approach(current.z, target.z, CAMERA.modeBlend, dt),
    )
  }
}

function loadView(): CameraView {
  try {
    const saved = localStorage.getItem(VIEW_KEY)
    return CAMERA_VIEW_ORDER.find((view) => view === saved) ?? 'chase'
  } catch {
    return 'chase'
  }
}
