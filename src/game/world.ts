import {
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { PALETTE, WORLD } from './constants'
import { mulberry32 } from './noise'
import { terrainHeight } from './terrain'

export type ObstacleKind = 'pillar' | 'block' | 'wall' | 'pyramid'

/** An axis-aligned obstacle in chunk-local space, footprint centred on (x, z) and resting on the ground. */
export interface Obstacle {
  kind: ObstacleKind
  x: number
  z: number
  width: number
  height: number
  depth: number
  /** Instance slot in the chunk mesh, so a smashed obstacle can be hidden. */
  slot: number
}

const unitBox = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
// A four-sided cone, rotated so its square base is axis-aligned with side 1.
const unitPyramid = new ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0)

const _position = new Vector3()
const _scale = new Vector3()
const _rotation = new Quaternion()
const _matrix = new Matrix4()

/** One slice of landscape plus its obstacles. Chunks are recycled and regenerated, never destroyed. */
class Chunk {
  readonly group = new Group()
  /** Obstacles in chunk-local space, for collision checks. */
  readonly obstacles: Obstacle[] = []
  /** Absolute chunk number since the page loaded. Drives the terrain, which never repeats or resets. */
  index = -1
  private readonly ground: Mesh
  private readonly boxes: InstancedMesh
  private readonly pyramids: InstancedMesh

  constructor(groundMaterial: MeshStandardMaterial, obstacleMaterial: MeshStandardMaterial) {
    const geometry = new PlaneGeometry(
      WORLD.chunkWidth,
      WORLD.chunkLength,
      WORLD.groundSegmentsX,
      WORLD.groundSegmentsZ,
    ).rotateX(-Math.PI / 2)
    this.ground = new Mesh(geometry, groundMaterial)
    this.ground.receiveShadow = true

    this.boxes = new InstancedMesh(unitBox, obstacleMaterial, WORLD.maxBoxesPerChunk)
    this.pyramids = new InstancedMesh(unitPyramid, obstacleMaterial, WORLD.maxPyramidsPerChunk)
    for (const mesh of [this.boxes, this.pyramids]) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    this.group.add(this.ground, this.boxes, this.pyramids)
  }

  /** Shape the ground for absolute chunk number `index`. */
  sculpt(index: number): void {
    this.index = index
    const position = this.ground.geometry.getAttribute('position') as BufferAttribute
    // Local z runs from +half (near edge) to -half (far edge); world z must grow with distance.
    const baseZ = index * WORLD.chunkLength
    for (let i = 0; i < position.count; i++) {
      position.setY(i, terrainHeight(position.getX(i), baseZ - position.getZ(i)))
    }
    position.needsUpdate = true
    this.ground.geometry.computeBoundingSphere()
  }

  /** Replace the obstacles with up to `target` new ones. The same `layoutSeed` always gives the same layout. */
  placeObstacles(target: number, layoutSeed: number): void {
    const random = mulberry32(WORLD.seed * 7919 + layoutSeed * 104729)
    this.obstacles.length = 0
    let boxCount = 0
    let pyramidCount = 0

    for (let attempt = 0; attempt < target * 6 && this.obstacles.length < target; attempt++) {
      const candidate = randomObstacle(random)
      if (this.obstacles.some((other) => overlaps(candidate, other))) continue
      if (candidate.kind === 'pyramid') {
        if (pyramidCount >= WORLD.maxPyramidsPerChunk) continue
        candidate.slot = pyramidCount++
        setInstance(this.pyramids, candidate)
      } else {
        if (boxCount >= WORLD.maxBoxesPerChunk) continue
        candidate.slot = boxCount++
        setInstance(this.boxes, candidate)
      }
      this.obstacles.push(candidate)
    }

    this.boxes.count = boxCount
    this.pyramids.count = pyramidCount
    for (const mesh of [this.boxes, this.pyramids]) {
      mesh.instanceMatrix.needsUpdate = true
      // Frustum culling uses this sphere; without it the mesh is culled as if it were a unit shape at the origin.
      mesh.computeBoundingSphere()
    }
  }

  /** Remove an obstacle the ship crashed through: hide its instance and drop it from collision. */
  smash(obstacle: Obstacle): void {
    const mesh = obstacle.kind === 'pyramid' ? this.pyramids : this.boxes
    mesh.setMatrixAt(obstacle.slot, _matrix.makeScale(0, 0, 0))
    mesh.instanceMatrix.needsUpdate = true
    this.obstacles.splice(this.obstacles.indexOf(obstacle), 1)
  }
}

/** Obstacles for the chunk `runIndex` chunks into a run. Chunks at or behind the start are empty. */
function obstacleCountFor(runIndex: number): number {
  if (runIndex < WORLD.calmChunks) return 0
  const max = WORLD.maxBoxesPerChunk + WORLD.maxPyramidsPerChunk
  return Math.min(max, 4 + Math.floor((runIndex - WORLD.calmChunks) * 0.8))
}

function randomObstacle(random: () => number): Obstacle {
  const range = (min: number, max: number) => min + random() * (max - min)
  const margin = 10
  const x = range(-WORLD.playHalfWidth, WORLD.playHalfWidth)
  const z = range(-WORLD.chunkLength / 2 + margin, WORLD.chunkLength / 2 - margin)
  const roll = random()
  if (roll < 0.35) return { kind: 'pillar', x, z, width: range(1, 3), height: range(6, 22), depth: range(1, 3), slot: -1 }
  if (roll < 0.6) return { kind: 'block', x, z, width: range(4, 12), height: range(3, 9), depth: range(4, 12), slot: -1 }
  if (roll < 0.8) return { kind: 'wall', x, z, width: range(18, 50), height: range(4, 12), depth: range(1.5, 3), slot: -1 }
  const side = range(6, 18)
  return { kind: 'pyramid', x, z, width: side, height: range(6, 20), depth: side, slot: -1 }
}

function overlaps(a: Obstacle, b: Obstacle): boolean {
  const gap = WORLD.obstacleGap
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 + gap
  )
}

function setInstance(mesh: InstancedMesh, obstacle: Obstacle): void {
  _position.set(obstacle.x, 0, obstacle.z)
  _scale.set(obstacle.width, obstacle.height, obstacle.depth)
  _matrix.compose(_position, _rotation, _scale)
  mesh.setMatrixAt(obstacle.slot, _matrix)
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
  private readonly chunks: Chunk[] = []
  private nextIndex = 0
  private calm = true
  /** Absolute index of the chunk the current run started in. */
  private runStart = 0

  constructor() {
    const groundMaterial = new MeshStandardMaterial({ color: PALETTE.ground, flatShading: true, roughness: 1 })
    const obstacleMaterial = new MeshStandardMaterial({ color: PALETTE.obstacle, flatShading: true, roughness: 0.85 })
    for (let i = 0; i < WORLD.chunkCount; i++) {
      const chunk = new Chunk(groundMaterial, obstacleMaterial)
      // First chunk sits under the ship, the rest extend ahead down -z.
      chunk.group.position.z = -i * WORLD.chunkLength
      chunk.sculpt(this.nextIndex++)
      this.populate(chunk)
      this.chunks.push(chunk)
      this.group.add(chunk.group)
    }
  }

  /** Clear the skies for the menu. */
  enterMenu(): void {
    this.calm = true
    for (const chunk of this.chunks) this.populate(chunk)
  }

  /** Start a run from wherever the ship is now. The same course is laid out every run. */
  beginRun(): void {
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
        chunk.sculpt(this.nextIndex++)
        this.populate(chunk)
      }
    }

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
   * Pyramids taper, so their footprint is measured at the ship's height.
   */
  collide(shipX: number, shipY: number, halfWidth: number, halfDepth: number, travelled: number): Obstacle | null {
    const offset = this.group.position.z
    for (const chunk of this.chunks) {
      const chunkZ = chunk.group.position.z + offset
      if (Math.abs(chunkZ) > WORLD.chunkLength / 2 + halfDepth + travelled) continue
      for (const obstacle of chunk.obstacles) {
        const taper = obstacle.kind === 'pyramid' ? Math.max(0, 1 - shipY / obstacle.height) : 1
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

  private populate(chunk: Chunk): void {
    const runIndex = chunk.index - this.runStart
    chunk.placeObstacles(this.calm ? 0 : obstacleCountFor(runIndex), runIndex)
  }
}
