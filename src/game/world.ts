import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { WORLD } from './constants'
import { mulberry32 } from './noise'
import type { Footprint, Piece, Shape } from './scenery'
import { terrainHeight } from './terrain'
import type { WorldTheme } from './worlds'

/** A solid thing in chunk-local space: its collision box plus the instance slots that draw it. */
export interface Obstacle extends Footprint {
  pieces: PieceRef[]
}

interface PieceRef {
  shape: Shape
  slot: number
}

const SHAPES: readonly Shape[] = ['box', 'pyramid', 'cloud']

/** Gems are the currency picked up in a run. They come in short rows down the flyable strip. */
const GEM = {
  /** Most gems one chunk can hold, and the odds that a chunk gets a row at all. */
  capacity: 8,
  rowChance: 0.7,
  minRow: 3,
  maxRow: 6,
  /** Distance between gems in a row. */
  spacing: 10,
  /** Rows are placed within this distance of the centre line, where a plane can reach them in time. */
  halfSpread: 75,
  /** Height of a gem's centre, level with the ship. */
  height: 1.2,
  size: 0.85,
  /** How far outside the ship's collision box a gem is still picked up, sideways and along the track. */
  reachX: 1.5,
  reachZ: 2.2,
  /** Clearance kept between a gem and any obstacle. */
  clearance: 3,
  spinSpeed: 2.6,
  color: 0xffc233,
} as const
/** Vertices in one row across the ground. */
const ROW_VERTICES = WORLD.groundSegmentsX + 1
const DECOR_PER_STEP = 8
/**
 * Milliseconds per frame spent rebuilding a recycled chunk. Rebuilding one in a single frame costs more
 * than a whole frame on a phone and shows as a stutter; it lands far beyond the fog, so there is time to spare.
 */
const REBUILD_BUDGET_MS = 3

function drain(steps: Generator<void>): void {
  while (!steps.next().done);
}

const unitBox = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
// A four-sided cone, rotated so its square base is axis-aligned with side 1.
const gemGeometry = new OctahedronGeometry(GEM.size).scale(0.7, 1, 0.7)
const unitPyramid = new ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0)
const UP = new Vector3(0, 1, 0)
const NO_SCALE = new Vector3(0, 0, 0)
const GEM_SCALE = new Vector3(1, 1, 1)

const _position = new Vector3()
const _scale = new Vector3()
const _rotation = new Quaternion()
const _matrix = new Matrix4()
const _color = new Color()

/** A gem in chunk-local space, and the instance slot that draws it. */
interface Gem {
  x: number
  z: number
  slot: number
  taken: boolean
}

interface ChunkMaterials {
  gem: MeshStandardMaterial
  ground: MeshStandardMaterial
  piece: MeshStandardMaterial
  cloud: MeshStandardMaterial
}

/**
 * One slice of landscape plus everything standing on it. Chunks are recycled and regenerated, never destroyed.
 * All the pieces of every world are boxes and pyramids in a few instanced meshes, coloured per instance.
 */
class Chunk {
  readonly group = new Group()
  /** Obstacles in chunk-local space, for collision checks. */
  readonly obstacles: Obstacle[] = []
  /** Gems still to be picked up, and the ones already taken, in chunk-local space. */
  readonly gems: Gem[] = []
  private readonly gemMesh: InstancedMesh
  /** Absolute chunk number since the page loaded. Drives the terrain, which never repeats or resets. */
  index = -1
  private readonly ground: Mesh
  private readonly meshes: Record<Shape, InstancedMesh>
  private readonly counts: Record<Shape, number> = { box: 0, pyramid: 0, cloud: 0 }

  constructor(materials: ChunkMaterials) {
    const geometry = new PlaneGeometry(
      WORLD.chunkWidth,
      WORLD.chunkLength,
      WORLD.groundSegmentsX,
      WORLD.groundSegmentsZ,
    ).rotateX(-Math.PI / 2)
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3), 3))
    this.ground = new Mesh(geometry, materials.ground)
    this.ground.receiveShadow = true

    this.meshes = {
      box: new InstancedMesh(unitBox, materials.piece, WORLD.boxCapacity),
      pyramid: new InstancedMesh(unitPyramid, materials.piece, WORLD.pyramidCapacity),
      cloud: new InstancedMesh(unitBox, materials.cloud, WORLD.cloudCapacity),
    }
    for (const mesh of Object.values(this.meshes)) {
      mesh.castShadow = true
      mesh.receiveShadow = true
      // Allocate the colour buffer now, so the first coloured piece does not trigger a shader rebuild mid-game.
      mesh.setColorAt(0, _color.setHex(0xffffff))
      mesh.count = 0
    }
    // Nothing flies above the clouds, so they never need a shadow on them.
    this.meshes.cloud.receiveShadow = false
    this.gemMesh = new InstancedMesh(gemGeometry, materials.gem, GEM.capacity)
    this.gemMesh.count = 0
    // Gems spin in place every frame, so a culling sphere would have to be rebuilt just as often.
    this.gemMesh.frustumCulled = false
    this.group.add(this.ground, ...Object.values(this.meshes), this.gemMesh)
  }

  /** Shape and colour the ground for absolute chunk number `index`. */
  sculpt(index: number, theme: WorldTheme): void {
    drain(this.sculptSteps(index, theme))
  }

  /** The same work as `sculpt`, pausing after every row of the ground so it can be spread over frames. */
  *sculptSteps(index: number, theme: WorldTheme): Generator<void> {
    this.index = index
    const position = this.ground.geometry.getAttribute('position') as BufferAttribute
    const color = this.ground.geometry.getAttribute('color') as BufferAttribute
    // Local z runs from +half (near edge) to -half (far edge); world z must grow with distance.
    const baseZ = index * WORLD.chunkLength
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const worldZ = baseZ - position.getZ(i)
      position.setY(i, terrainHeight(x, worldZ, theme.terrain))
      theme.groundColor(x, worldZ, _color)
      color.setXYZ(i, _color.r, _color.g, _color.b)
      if ((i + 1) % ROW_VERTICES === 0) yield
    }
    position.needsUpdate = true
    color.needsUpdate = true
    this.ground.geometry.computeBoundingSphere()
  }

  /**
   * Lay the chunk out afresh: up to `target` obstacles, then the decoration. The same `layoutSeed` always
   * gives the same obstacles, and the decoration only ever depends on the chunk number, so re-laying a
   * chunk that is in view changes nothing but the obstacles.
   */
  layout(theme: WorldTheme, target: number, layoutSeed: number, withGems: boolean): void {
    drain(this.layoutSteps(theme, target, layoutSeed, withGems))
  }

  /** The same work as `layout`, pausing between things so it can be spread over frames. */
  *layoutSteps(theme: WorldTheme, target: number, layoutSeed: number, withGems: boolean): Generator<void> {
    for (const shape of SHAPES) this.counts[shape] = 0
    this.obstacles.length = 0

    const random = mulberry32(WORLD.seed * 7919 + layoutSeed * 104729)
    for (let attempt = 0; attempt < target * 6 && this.obstacles.length < target; attempt++) {
      const { footprint, pieces } = theme.scenery.obstacle(random)
      if (this.obstacles.some((other) => overlaps(footprint, other))) continue
      const refs = this.write(pieces)
      if (!refs) break
      this.obstacles.push({ ...footprint, pieces: refs })
      yield
    }
    yield
    this.scatterGems(withGems ? mulberry32(WORLD.seed * 6151 + layoutSeed * 92821) : null)

    const baseZ = this.index * WORLD.chunkLength
    const groundAt = (x: number, z: number) => terrainHeight(x, baseZ - z, theme.terrain)
    const decor = theme.scenery.decor(mulberry32(WORLD.seed * 31 + this.index * 7907), groundAt)
    yield
    let written = 0
    for (const thing of decor) {
      if (thing.some((piece) => this.obstacles.some((obstacle) => covers(obstacle, piece)))) continue
      if (!this.write(thing)) break
      if (++written % DECOR_PER_STEP === 0) yield
    }

    for (const shape of SHAPES) {
      const mesh = this.meshes[shape]
      mesh.count = this.counts[shape]
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor!.needsUpdate = true
      // Frustum culling uses this sphere; without it the mesh is culled as if it were a unit shape at the origin.
      mesh.computeBoundingSphere()
    }
  }

  /** Lay a row of gems down the strip, clear of the obstacles. With no generator the chunk gets none. */
  private scatterGems(random: (() => number) | null): void {
    this.gems.length = 0
    if (random && random() < GEM.rowChance) {
      const length = GEM.minRow + Math.floor(random() * (GEM.maxRow - GEM.minRow + 1))
      const x = (random() * 2 - 1) * GEM.halfSpread
      const reach = WORLD.chunkLength / 2 - 10
      // Rows run away from the ship, so the first gem is the nearest: the largest local z.
      const startZ = reach - random() * (2 * reach - (length - 1) * GEM.spacing)
      for (let i = 0; i < length; i++) {
        const z = startZ - i * GEM.spacing
        const blocked = this.obstacles.some(
          (obstacle) =>
            Math.abs(x - obstacle.x) < obstacle.width / 2 + GEM.clearance &&
            Math.abs(z - obstacle.z) < obstacle.depth / 2 + GEM.clearance,
        )
        if (!blocked) this.gems.push({ x, z, slot: this.gems.length, taken: false })
      }
    }
    this.gemMesh.count = this.gems.length
    this.spinGems(0)
  }

  /** Turn every gem that is still there to `angle`. Taken gems are shrunk to nothing. */
  spinGems(angle: number): void {
    if (this.gems.length === 0) return
    for (const gem of this.gems) {
      _position.set(gem.x, GEM.height, gem.z)
      _rotation.setFromAxisAngle(UP, angle + gem.z * 0.08)
      this.gemMesh.setMatrixAt(gem.slot, _matrix.compose(_position, _rotation, gem.taken ? NO_SCALE : GEM_SCALE))
    }
    this.gemMesh.instanceMatrix.needsUpdate = true
  }

  /** Remove an obstacle the ship crashed through: hide its pieces and drop it from collision. */
  smash(obstacle: Obstacle): void {
    for (const { shape, slot } of obstacle.pieces) {
      const mesh = this.meshes[shape]
      mesh.setMatrixAt(slot, _matrix.makeScale(0, 0, 0))
      mesh.instanceMatrix.needsUpdate = true
    }
    this.obstacles.splice(this.obstacles.indexOf(obstacle), 1)
  }

  /** Write a whole thing into the instance buffers, or nothing at all if it would not fit. */
  private write(pieces: Piece[]): PieceRef[] | null {
    for (const shape of SHAPES) {
      const needed = pieces.reduce((n, piece) => n + (piece.shape === shape ? 1 : 0), 0)
      if (this.counts[shape] + needed > this.meshes[shape].instanceMatrix.count) return null
    }
    return pieces.map((piece) => {
      const mesh = this.meshes[piece.shape]
      const slot = this.counts[piece.shape]++
      _position.set(piece.x, piece.y, piece.z)
      _scale.set(piece.w, piece.h, piece.d)
      _rotation.setFromAxisAngle(UP, piece.yaw ?? 0)
      mesh.setMatrixAt(slot, _matrix.compose(_position, _rotation, _scale))
      mesh.setColorAt(slot, _color.setHex(piece.color))
      return { shape: piece.shape, slot }
    })
  }
}

/** Obstacles for the chunk `runIndex` chunks into a run. Chunks at or behind the start are empty. */
function obstacleCountFor(runIndex: number): number {
  if (runIndex < WORLD.calmChunks) return 0
  return Math.min(WORLD.maxObstaclesPerChunk, 4 + Math.floor((runIndex - WORLD.calmChunks) * 0.8))
}

function overlaps(a: Footprint, b: Footprint): boolean {
  const gap = WORLD.obstacleGap
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 + gap
  )
}

/** True if the piece would stand inside the obstacle's box. Things floating above it are fine. */
function covers(obstacle: Footprint, piece: Piece): boolean {
  return (
    piece.y < obstacle.height &&
    Math.abs(piece.x - obstacle.x) < (obstacle.width + piece.w) / 2 &&
    Math.abs(piece.z - obstacle.z) < (obstacle.depth + piece.d) / 2
  )
}

/**
 * The scrolling landscape. Terrain streams forever and is never reset, so switching between the menu,
 * a run and a restart is seamless. Only the obstacles change: none while `calm` (the menu), and a
 * fresh course that starts at the ship's current position whenever a run begins.
 */
export class World {
  readonly group = new Group()
  /** Distance flown in the current run, in world units. */
  distance = 0
  private theme: WorldTheme
  private readonly chunks: Chunk[] = []
  private nextIndex = 0
  private calm = true
  /** Absolute index of the chunk the current run started in. */
  private runStart = 0
  private gemAngle = 0
  /** Recycled chunks still being rebuilt, oldest first. */
  private readonly rebuilds: Generator<void>[] = []

  constructor(theme: WorldTheme) {
    this.theme = theme
    const materials: ChunkMaterials = {
      // Self-lit, so gems read as bright pickups even in shadow and at dusk.
      gem: new MeshStandardMaterial({ color: GEM.color, flatShading: true, roughness: 0.3, emissive: GEM.color, emissiveIntensity: 0.55 }),
      ground: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }),
      piece: new MeshStandardMaterial({ flatShading: true, roughness: 0.85 }),
      // Partly self-lit: a cloud scatters light, so its shaded sides and underside stay bright.
      cloud: new MeshStandardMaterial({ flatShading: true, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.38 }),
    }
    for (let i = 0; i < WORLD.chunkCount; i++) {
      const chunk = new Chunk(materials)
      // First chunk sits under the ship, the rest extend ahead down -z.
      chunk.group.position.z = -i * WORLD.chunkLength
      chunk.sculpt(this.nextIndex++, theme)
      this.populate(chunk)
      this.chunks.push(chunk)
      this.group.add(chunk.group)
    }
  }

  /** Rebuild every chunk in place for another world. The landscape keeps its position and chunk numbers. */
  setTheme(theme: WorldTheme): void {
    this.continueRebuilds(Infinity)
    this.theme = theme
    for (const chunk of this.chunks) {
      chunk.sculpt(chunk.index, theme)
      this.populate(chunk)
    }
  }

  /** Clear the skies for the menu. */
  enterMenu(): void {
    this.continueRebuilds(Infinity)
    this.calm = true
    for (const chunk of this.chunks) this.populate(chunk)
  }

  /** Start a run from wherever the ship is now. The same course is laid out every run. */
  beginRun(): void {
    this.continueRebuilds(Infinity)
    this.distance = 0
    this.calm = false
    const offset = this.group.position.z
    let under = this.chunks[0]!
    for (const chunk of this.chunks) {
      if (Math.abs(chunk.group.position.z + offset) < Math.abs(under.group.position.z + offset)) under = chunk
    }
    this.runStart = under.index
    for (const chunk of this.chunks) this.populate(chunk)
  }

  /** Scroll the world toward the camera. The ship itself never moves forward. */
  update(dt: number, speed: number): void {
    const step = speed * dt
    this.distance += step
    this.group.position.z += step

    const offset = this.group.position.z
    const loopLength = WORLD.chunkCount * WORLD.chunkLength
    for (const chunk of this.chunks) {
      const farEdge = chunk.group.position.z + offset - WORLD.chunkLength / 2
      if (farEdge > WORLD.recycleBehind) {
        chunk.group.position.z -= loopLength
        this.rebuilds.push(this.rebuildSteps(chunk, this.nextIndex++))
      }
    }
    this.continueRebuilds(REBUILD_BUDGET_MS)

    this.gemAngle += GEM.spinSpeed * dt
    for (const chunk of this.chunks) chunk.spinGems(this.gemAngle)

    // Origin rebasing: pull the group back and push the chunks forward by the same amount.
    if (offset > WORLD.rebaseDistance) {
      this.group.position.z -= WORLD.rebaseDistance
      for (const chunk of this.chunks) chunk.group.position.z += WORLD.rebaseDistance
    }
  }

  /**
   * Test a ship-sized box at (shipX, z = 0) against nearby obstacles.
   * The first obstacle hit is smashed and returned; null means the way is clear.
   * `travelled` is how far the world scrolled this frame; the test sweeps that span so fast frames cannot skip thin walls.
   * Tapered obstacles narrow toward the top, so their footprint is measured at the ship's height.
   */
  collide(shipX: number, shipY: number, halfWidth: number, halfDepth: number, travelled: number): Obstacle | null {
    const offset = this.group.position.z
    for (const chunk of this.chunks) {
      const chunkZ = chunk.group.position.z + offset
      if (Math.abs(chunkZ) > WORLD.chunkLength / 2 + halfDepth + travelled) continue
      for (const obstacle of chunk.obstacles) {
        const taper = obstacle.taper ? Math.max(0, 1 - shipY / obstacle.height) : 1
        const reach = (obstacle.depth * taper) / 2 + halfDepth
        const z = chunkZ + obstacle.z
        const hitZ = z > -reach && z - travelled < reach
        const hitX = Math.abs(shipX - obstacle.x) < (obstacle.width * taper) / 2 + halfWidth
        if (hitZ && hitX) {
          chunk.smash(obstacle)
          return obstacle
        }
      }
    }
    return null
  }

  /** Sculpt and populate a recycled chunk, in steps. */
  /**
   * Pick up every gem a ship-sized box at (shipX, z = 0) touched this frame, and return how many.
   * Like `collide`, the test sweeps the distance the world scrolled, so fast frames cannot skip a gem.
   */
  collect(shipX: number, halfWidth: number, halfDepth: number, travelled: number): number {
    const offset = this.group.position.z
    let collected = 0
    for (const chunk of this.chunks) {
      const chunkZ = chunk.group.position.z + offset
      if (Math.abs(chunkZ) > WORLD.chunkLength / 2 + halfDepth + GEM.reachZ + travelled) continue
      for (const gem of chunk.gems) {
        if (gem.taken) continue
        const reach = halfDepth + GEM.reachZ
        const z = chunkZ + gem.z
        if (z > -reach && z - travelled < reach && Math.abs(shipX - gem.x) < halfWidth + GEM.reachX) {
          gem.taken = true
          collected++
        }
      }
    }
    return collected
  }

  private *rebuildSteps(chunk: Chunk, index: number): Generator<void> {
    yield* chunk.sculptSteps(index, this.theme)
    const runIndex = chunk.index - this.runStart
    yield* chunk.layoutSteps(this.theme, this.calm ? 0 : obstacleCountFor(runIndex), runIndex, this.hasGems(runIndex))
  }

  /** Work through pending rebuilds for up to `budget` milliseconds. */
  private continueRebuilds(budget: number): void {
    const deadline = performance.now() + budget
    while (this.rebuilds.length > 0) {
      if (this.rebuilds[0]!.next().done) this.rebuilds.shift()
      else if (performance.now() >= deadline) return
    }
  }

  /** Gems only appear during a run, from the chunk just ahead of where it started. */
  private hasGems(runIndex: number): boolean {
    return !this.calm && runIndex >= 1
  }

  private populate(chunk: Chunk): void {
    const runIndex = chunk.index - this.runStart
    chunk.layout(this.theme, this.calm ? 0 : obstacleCountFor(runIndex), runIndex, this.hasGems(runIndex))
  }
}
