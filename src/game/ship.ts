import { DoubleSide, Euler, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { CAMERA, SHIP, WORLD } from './constants'
import { approach, clamp } from './math'
import { buildPlaneGeometry } from './planes'
import type { PlaneSpec } from './planes'
import { SKINS } from './skins'
import type { Skin } from './skins'

const COCKPIT_TILT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), CAMERA.cockpitPitch)
const DOWN = new Vector3(0, -1, 0)
const _euler = new Euler()

/** The player's glider. It only ever moves sideways; the world scrolls past it. */
export class Ship {
  readonly object = new Group()
  x = 0
  vx = 0
  /** Current roll in radians. Negative rolls the right wing down. */
  bank = 0
  plane: PlaneSpec
  skin: Skin = SKINS[0]!
  /** Colour of the wingtip trails: the skin's, or the plane's own. */
  trailColor = 0xffffff
  /** First-person eye point in model space: just above the hull, ahead of any fins. */
  readonly cockpit = new Vector3()

  // Double sided so a plane design with a mis-wound face still renders and shadows correctly.
  private readonly hull = new MeshStandardMaterial({ flatShading: true, roughness: 0.55, side: DoubleSide })
  private readonly accent = new MeshStandardMaterial({ flatShading: true, roughness: 0.7, side: DoubleSide })
  private readonly body = new Mesh(undefined, [this.hull, this.accent])
  private readonly geometries = new Map<string, BufferGeometry>()
  private readonly cockpits = new Map<string, Vector3>()

  constructor(plane: PlaneSpec) {
    this.plane = plane
    this.body.castShadow = true
    this.object.add(this.body)
    this.object.position.y = SHIP.hoverHeight
    this.setPlane(plane)
  }

  /** Swap the model, colours and handling. */
  setPlane(plane: PlaneSpec): void {
    this.plane = plane
    let geometry = this.geometries.get(plane.id)
    if (!geometry) {
      geometry = buildPlaneGeometry(plane)
      this.geometries.set(plane.id, geometry)
    }
    this.body.geometry = geometry
    this.cockpit.copy(this.cockpitFor(plane.id, geometry))
    this.setSkin(this.skin)
  }

  /** Repaint the current plane. */
  setSkin(skin: Skin): void {
    this.skin = skin
    this.hull.color.setHex(skin.hull ?? this.plane.hullColor)
    this.accent.color.setHex(skin.accent ?? this.plane.accentColor)
    this.trailColor = skin.trail ?? this.plane.trailColor
  }

  reset(): void {
    this.x = 0
    this.vx = 0
    this.bank = 0
    this.object.visible = true
    this.object.position.set(0, SHIP.hoverHeight, 0)
    this.object.rotation.set(0, 0, 0)
  }

  /** Flicker while invulnerable after a crash. */
  setBlink(active: boolean, time: number): void {
    this.object.visible = !active || Math.floor(time * 14) % 2 === 0
  }

  update(dt: number, steer: number): void {
    const plane = this.plane
    const targetVx = steer * plane.maxLateralSpeed
    const rate = steer === 0 ? plane.steerDamping : plane.steerResponse
    this.vx = approach(this.vx, targetVx, rate, dt)
    this.x += this.vx * dt
    if (Math.abs(this.x) > WORLD.playHalfWidth) {
      this.x = clamp(this.x, -WORLD.playHalfWidth, WORLD.playHalfWidth)
      this.vx = 0
    }

    const lean = this.vx / plane.maxLateralSpeed
    this.bank = approach(this.bank, -lean * SHIP.maxBank, SHIP.bankResponse, dt)

    this.object.position.set(this.x, SHIP.hoverHeight, 0)
    this.object.rotation.set(0, -lean * SHIP.maxYaw, this.bank)
  }

  /** World-space eye position and orientation for the first-person view. It yaws with the ship and rolls with part of its bank. */
  cockpitPose(position: Vector3, quaternion: Quaternion): void {
    this.object.updateMatrixWorld()
    this.object.localToWorld(position.copy(this.cockpit))
    _euler.set(0, this.object.rotation.y, this.bank * CAMERA.cockpitRoll)
    quaternion.setFromEuler(_euler).multiply(COCKPIT_TILT)
  }

  /**
   * Menu pose: hover nose-up, tilted toward the camera, with a slow bob and roll so the whole shape gets shown off.
   * `swing` turns the plane from side to side, for VR, where the player stands still instead of the camera circling.
   */
  showcase(time: number, swing = 0): void {
    this.x = 0
    this.vx = 0
    this.bank = 0
    this.object.visible = true
    this.object.position.set(0, SHIP.hoverHeight + 0.4 + Math.sin(time * 1.4) * 0.15, 0)
    this.object.rotation.set(
      0.32 + Math.sin(time * 0.9) * 0.06,
      Math.sin(time * CAMERA.showcaseSwingSpeed) * swing,
      Math.sin(time * 0.7) * 0.3,
    )
  }

  /** Find the top of the hull under the eye point by casting a ray down onto the model. */
  private cockpitFor(id: string, geometry: BufferGeometry): Vector3 {
    let eye = this.cockpits.get(id)
    if (!eye) {
      const probe = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
      // Just off the centre line, so the ray never runs exactly along the ridge where two faces meet.
      const hit = new Raycaster(new Vector3(0.001, 10, CAMERA.cockpitZ), DOWN).intersectObject(probe)[0]
      eye = new Vector3(0, (hit ? hit.point.y : 0.3) + CAMERA.cockpitEyeHeight, CAMERA.cockpitZ)
      this.cockpits.set(id, eye)
    }
    return eye
  }
}
