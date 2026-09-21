import { DoubleSide, Group, Mesh, MeshStandardMaterial } from 'three'
import type { BufferGeometry } from 'three'
import { SHIP, WORLD } from './constants'
import { approach, clamp } from './math'
import { buildPlaneGeometry } from './planes'
import type { PlaneSpec } from './planes'

/** The player's glider. It only ever moves sideways; the world scrolls past it. */
export class Ship {
  readonly object = new Group()
  x = 0
  vx = 0
  /** Current roll in radians. Negative rolls the right wing down. */
  bank = 0
  plane: PlaneSpec

  // Double sided so a plane design with a mis-wound face still renders and shadows correctly.
  private readonly hull = new MeshStandardMaterial({ flatShading: true, roughness: 0.55, side: DoubleSide })
  private readonly accent = new MeshStandardMaterial({ flatShading: true, roughness: 0.7, side: DoubleSide })
  private readonly body = new Mesh(undefined, [this.hull, this.accent])
  private readonly geometries = new Map<string, BufferGeometry>()

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
    this.hull.color.setHex(plane.hullColor)
    this.accent.color.setHex(plane.accentColor)
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

  /** Menu pose: hover nose-up, tilted toward the camera, with a slow bob and roll so the whole shape gets shown off. */
  showcase(time: number): void {
    this.x = 0
    this.vx = 0
    this.bank = 0
    this.object.visible = true
    this.object.position.set(0, SHIP.hoverHeight + 0.4 + Math.sin(time * 1.4) * 0.15, 0)
    this.object.rotation.set(0.32 + Math.sin(time * 0.9) * 0.06, 0, Math.sin(time * 0.7) * 0.3)
  }
}
