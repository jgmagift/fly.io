import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three'
import type { Ship } from './ship'

/** Samples kept per trail, how far back the glow reaches, and the ribbon width along the wing.
 * The cameras only ever see the first six or so units behind the plane, so the fade has to finish within that. */
const SAMPLES = 48
const LENGTH = 7.5
const WIDTH = 0.1

const _inner = new Vector3()
const _outer = new Vector3()

/**
 * A glowing ribbon streaming from one wingtip. The ship never moves forward, so each frame every
 * sample slides back by the distance the world scrolled and a new sample is pinned to the wingtip.
 * The ribbon's edges follow the wing, so it lies flat in level flight and stands up like a wall in a bank.
 */
class Trail {
  readonly mesh: Mesh
  private readonly side: -1 | 1
  /** Per sample: inner edge xyz, then outer edge xyz. Sample 0 is the wingtip. */
  private readonly positions = new Float32Array(SAMPLES * 6)
  private readonly colors = new Float32Array(SAMPLES * 6)
  private readonly positionAttribute: BufferAttribute
  private readonly colorAttribute: BufferAttribute
  private readonly color = new Color()

  constructor(side: -1 | 1) {
    this.side = side
    const geometry = new BufferGeometry()
    this.positionAttribute = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage)
    this.colorAttribute = new BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', this.positionAttribute)
    geometry.setAttribute('color', this.colorAttribute)
    const index: number[] = []
    for (let i = 0; i < SAMPLES - 1; i++) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geometry.setIndex(index)

    // Additive and unfogged: faded samples are black, which adds nothing, so no alpha is needed.
    const material = new MeshBasicMaterial({
      vertexColors: true,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    })
    this.mesh = new Mesh(geometry, material)
    this.mesh.frustumCulled = false
  }

  /** Collapse the whole ribbon onto the wingtip, so a teleport or plane swap leaves no streak. */
  reset(ship: Ship): void {
    this.readWingtip(ship)
    for (let i = 0; i < SAMPLES; i++) this.writeSample(i)
    this.positionAttribute.needsUpdate = true
  }

  update(ship: Ship, travelled: number): void {
    // Age every sample by one slot and slide it back with the world.
    this.positions.copyWithin(6, 0, (SAMPLES - 1) * 6)
    for (let i = 1; i < SAMPLES; i++) {
      this.positions[i * 6 + 2]! += travelled
      this.positions[i * 6 + 5]! += travelled
    }
    this.readWingtip(ship)
    this.writeSample(0)

    // Fade by distance behind the wingtip, and by age so a slow scroll still ends softly.
    this.color.setHex(ship.trailColor)
    const headZ = this.positions[2]!
    for (let i = 0; i < SAMPLES; i++) {
      const byDistance = 1 - (this.positions[i * 6 + 2]! - headZ) / LENGTH
      const byAge = 1 - i / (SAMPLES - 1)
      const fade = Math.max(0, Math.min(byDistance, byAge)) ** 1.6 * 0.8
      for (const vertex of [i * 6, i * 6 + 3]) {
        this.colors[vertex] = this.color.r * fade
        this.colors[vertex + 1] = this.color.g * fade
        this.colors[vertex + 2] = this.color.b * fade
      }
    }
    this.positionAttribute.needsUpdate = true
    this.colorAttribute.needsUpdate = true
  }

  private readWingtip(ship: Ship): void {
    const [x, y, z] = ship.plane.wingtip
    _outer.set(this.side * x, y, z)
    _inner.set(this.side * (x - WIDTH), y, z)
    ship.object.localToWorld(_outer)
    ship.object.localToWorld(_inner)
  }

  private writeSample(i: number): void {
    this.positions.set([_inner.x, _inner.y, _inner.z, _outer.x, _outer.y, _outer.z], i * 6)
  }
}

/** Both wingtip trails. Add `group` to the scene, not to the ship: the ribbons live in world space. */
export class Trails {
  readonly group = new Group()
  private readonly trails = [new Trail(-1), new Trail(1)]

  constructor() {
    for (const trail of this.trails) this.group.add(trail.mesh)
  }

  reset(ship: Ship): void {
    ship.object.updateMatrixWorld()
    for (const trail of this.trails) trail.reset(ship)
  }

  update(ship: Ship, travelled: number): void {
    this.group.visible = ship.object.visible
    ship.object.updateMatrixWorld()
    for (const trail of this.trails) trail.update(ship, travelled)
  }
}
