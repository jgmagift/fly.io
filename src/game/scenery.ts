import { WORLD } from './constants'

/** Clouds are boxes too, but drawn with their own self-lit material so they stay white from underneath. */
export type Shape = 'box' | 'pyramid' | 'cloud'

/**
 * One instanced box or pyramid in chunk-local space: footprint centred on (x, z), bottom face at y,
 * size w by h by d, turned by `yaw` about the vertical.
 */
export interface Piece {
  shape: Shape
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  color: number
  yaw?: number
}

/** The collision box of an obstacle, centred on (x, z) and resting on the ground. Tapered ones narrow toward the top. */
export interface Footprint {
  x: number
  z: number
  width: number
  height: number
  depth: number
  taper: boolean
}

export interface ObstacleDesign {
  footprint: Footprint
  pieces: Piece[]
}

export type Random = () => number
/** Terrain height at a chunk-local position. */
export type GroundAt = (x: number, z: number) => number

/**
 * What a world is built from: obstacles rolled into the flyable strip, and harmless scenery around
 * and above it. Decoration comes back as things, each a list of pieces, so a whole sheep can be left
 * out when it would stand inside a cottage.
 */
export interface Scenery {
  obstacle(random: Random): ObstacleDesign
  decor(random: Random, groundAt: GroundAt): Piece[][]
}

function range(random: Random, min: number, max: number): number {
  return min + random() * (max - min)
}

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!
}

function side(random: Random): -1 | 1 {
  return random() < 0.5 ? -1 : 1
}

function count(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}

function box(x: number, y: number, z: number, w: number, h: number, d: number, color: number): Piece {
  return { shape: 'box', x, y, z, w, h, d, color }
}

function pyramid(x: number, y: number, z: number, w: number, h: number, d: number, color: number): Piece {
  return { shape: 'pyramid', x, y, z, w, h, d, color }
}

function puff(x: number, y: number, z: number, w: number, h: number, d: number, color: number): Piece {
  return { shape: 'cloud', x, y, z, w, h, d, color }
}

/** A spot in the flyable strip, clear of the chunk's front and back edges. */
function spot(random: Random): { x: number; z: number } {
  const margin = 10
  return {
    x: range(random, -WORLD.playHalfWidth, WORLD.playHalfWidth),
    z: range(random, -WORLD.chunkLength / 2 + margin, WORLD.chunkLength / 2 - margin),
  }
}

/** The piece `local` moved to (cx, cy, cz) and turned by `yaw`, so a many-piece thing can face any way. */
function turned(local: Piece, cx: number, cy: number, cz: number, yaw: number): Piece {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return { ...local, x: cx + local.x * cos + local.z * sin, y: cy + local.y, z: cz - local.x * sin + local.z * cos, yaw }
}

// ---- World one: dark monoliths on dusk sand

const MONOLITH = 0x201d24

export const monoliths: Scenery = {
  obstacle(random) {
    const { x, z } = spot(random)
    const roll = random()
    let footprint: Footprint
    if (roll < 0.35) {
      footprint = { x, z, width: range(random, 1, 3), height: range(random, 6, 22), depth: range(random, 1, 3), taper: false }
    } else if (roll < 0.6) {
      footprint = { x, z, width: range(random, 4, 12), height: range(random, 3, 9), depth: range(random, 4, 12), taper: false }
    } else if (roll < 0.8) {
      footprint = { x, z, width: range(random, 18, 50), height: range(random, 4, 12), depth: range(random, 1.5, 3), taper: false }
    } else {
      const sideLength = range(random, 6, 18)
      footprint = { x, z, width: sideLength, height: range(random, 6, 20), depth: sideLength, taper: true }
    }
    const { width, height, depth, taper } = footprint
    return { footprint, pieces: [{ shape: taper ? 'pyramid' : 'box', x, y: 0, z, w: width, h: height, d: depth, color: MONOLITH }] }
  },
  decor: () => [],
}

// ---- World two: a voxel village under fluffy clouds

const TRUNK = 0x7a4b2a
/** Mostly greens, with the odd autumn or blossom tree. */
const CANOPIES = [0x4caf50, 0x5cbf5a, 0x3e9e57, 0x7ccd4a, 0x4caf50, 0x2e9e5b, 0x62c462, 0xf29b3d, 0xe85d3a, 0xf28cb1] as const
const WALLS = [0xf6efe4, 0xefe0c8, 0xfdf8f0] as const
const ROOFS = [0x8b4a2b, 0xb5502f, 0x6d3f2a] as const
const DOOR = 0x5b3a21
const WINDOW = 0xa6dcf7
const CHIMNEY = 0x8a6a5a
const HEDGE = 0x3f9d4a
const FENCE = 0xa0703f
const HAY = 0xe8c14a
const CLOUD = 0xffffff
const CLOUD_SHADE = 0xf3f7ff
const WOOL = 0xfbfbf7
const FLEECE_FACE = 0xd9b3ad
const HOOVES = 0x4c4a55
const FLOWERS = [0xff6b8a, 0xffb347, 0xff4d4d, 0xffffff, 0xf8e16c, 0xff8fc8] as const

interface Built {
  pieces: Piece[]
  width: number
  depth: number
  height: number
}

/** A short trunk under a big blocky canopy, sometimes with a second tier. The trunk is sunk so it meets a slope. */
function tree(random: Random, x: number, y: number, z: number, scale: number): Built {
  const trunkW = range(random, 0.8, 1.3) * scale
  const trunkH = range(random, 0.8, 1.2) * scale
  const canopyW = range(random, 4, 9) * scale
  const canopyD = canopyW * range(random, 0.8, 1.2)
  const canopyH = range(random, 3.5, 7) * scale
  const color = pick(random, CANOPIES)
  const pieces = [box(x, y - 1, z, trunkW, trunkH + 1, trunkW, TRUNK), box(x, y + trunkH, z, canopyW, canopyH, canopyD, color)]
  let height = trunkH + canopyH
  if (random() < 0.4) {
    const tierH = canopyH * 0.55
    pieces.push(box(x, y + height - 0.2, z, canopyW * 0.6, tierH, canopyD * 0.6, color))
    height += tierH - 0.2
  }
  return { pieces, width: canopyW, depth: canopyD, height }
}

function cottage(random: Random, x: number, z: number): Built {
  const w = range(random, 6, 11)
  const d = range(random, 6, 10)
  const h = range(random, 3.5, 6)
  const roofH = range(random, 2.5, 4.5)
  const front = z + d / 2
  const pieces = [
    box(x, 0, z, w, h, d, pick(random, WALLS)),
    pyramid(x, h, z, w + 1.4, roofH, d + 1.4, pick(random, ROOFS)),
    // Door and windows on the face the player sees coming.
    box(x + range(random, -w / 8, w / 8), 0, front, 1.3, 2.2, 0.2, DOOR),
    box(x - w / 3.2, 1.6, front, 1.1, 1.1, 0.2, WINDOW),
    box(x + w / 3.2, 1.6, front, 1.1, 1.1, 0.2, WINDOW),
  ]
  if (random() < 0.5) pieces.push(box(x + w / 4, h + roofH * 0.35, z - d / 5, 0.9, roofH * 0.65 + 0.6, 0.9, CHIMNEY))
  return { pieces, width: w, depth: d, height: h + roofH }
}

/** A long low hedge dotted with blooms, or a fence of posts and a rail. Both force a sideways move, like world one's walls. */
function hedge(random: Random, x: number, z: number): Built {
  if (random() < 0.35) {
    const w = range(random, 14, 36)
    const posts = Math.floor(w / 4)
    const pieces = [box(x, 0.6, z, w, 0.8, 0.3, FENCE)]
    for (let i = 0; i <= posts; i++) pieces.push(box(x - w / 2 + (i * w) / posts, 0, z, 0.6, 1.9, 0.6, FENCE))
    return { pieces, width: w, depth: 0.6, height: 1.9 }
  }
  const w = range(random, 16, 44)
  const h = range(random, 1.8, 3.2)
  const d = range(random, 1.6, 2.6)
  const pieces = [box(x, 0, z, w, h, d, HEDGE)]
  for (let i = count(random, 2, 5); i > 0; i--) {
    pieces.push(box(x + range(random, -w / 2 + 1, w / 2 - 1), h - 0.15, z, 0.7, 0.6, 0.7, pick(random, FLOWERS)))
  }
  return { pieces, width: w, depth: d, height: h }
}

function haystack(random: Random, x: number, z: number): Built {
  const w = range(random, 5, 9)
  const h = range(random, 4, 8)
  return { pieces: [pyramid(x, 0, z, w, h, w, HAY)], width: w, depth: w, height: h }
}

/** A slab with a few bumps on top, and sometimes a lower lobe to one side. */
function cloud(random: Random, x: number, y: number, z: number): Piece[] {
  const w = range(random, 9, 24)
  const h = range(random, 2.5, 4.5)
  const d = range(random, 5, 11)
  const pieces = [puff(x, y, z, w, h, d, CLOUD)]
  for (let i = count(random, 2, 3); i > 0; i--) {
    const bumpW = w * range(random, 0.35, 0.7)
    const bumpD = d * range(random, 0.5, 0.9)
    pieces.push(puff(x + range(random, -1, 1) * (w / 3), y + h - 0.8, z + range(random, -1, 1) * (d / 4), bumpW, range(random, 2, 4), bumpD, CLOUD))
  }
  if (random() < 0.5) pieces.push(puff(x + side(random) * (w / 2), y + 0.4, z, w * 0.4, h * 0.7, d * 0.8, CLOUD_SHADE))
  return pieces
}

/** Legs, a woolly body and a pink face, standing whichever way it likes. */
function sheep(random: Random, x: number, y: number, z: number): Piece[] {
  const yaw = random() * Math.PI * 2
  return [
    box(0, -0.15, 0, 0.7, 0.55, 1.0, HOOVES),
    box(0, 0.32, 0, 1.15, 0.85, 1.5, WOOL),
    box(0, 0.7, -0.85, 0.55, 0.55, 0.5, FLEECE_FACE),
  ].map((piece) => turned(piece, x, y, z, yaw))
}

function flowers(random: Random, x: number, y: number, z: number): Piece[] {
  const pieces: Piece[] = []
  for (let i = count(random, 2, 3); i > 0; i--) {
    const s = range(random, 0.5, 0.9)
    pieces.push(box(x + range(random, -1.3, 1.3), y - 0.1, z + range(random, -1.3, 1.3), s, range(random, 0.45, 0.7), s, pick(random, FLOWERS)))
  }
  return pieces
}

export const village: Scenery = {
  obstacle(random) {
    const { x, z } = spot(random)
    const roll = random()
    let built: Built
    let taper = false
    if (roll < 0.42) built = tree(random, x, 0, z, range(random, 0.9, 1.3))
    else if (roll < 0.62) built = cottage(random, x, z)
    else if (roll < 0.82) built = hedge(random, x, z)
    else {
      built = haystack(random, x, z)
      taper = true
    }
    return { footprint: { x, z, width: built.width, height: built.height, depth: built.depth, taper }, pieces: built.pieces }
  },

  decor(random, groundAt) {
    const things: Piece[][] = []
    const half = WORLD.chunkLength / 2
    const edge = WORLD.chunkWidth / 2 - 25
    const strip = WORLD.playHalfWidth

    // Clouds: some drift high over the strip, above every camera view; the rest sit low among the hills.
    for (let i = count(random, 14, 20); i > 0; i--) {
      const z = range(random, -half, half)
      if (random() < 0.55) {
        things.push(cloud(random, range(random, -170, 170), range(random, 14, 40), z))
      } else {
        const x = side(random) * range(random, strip + 15, edge)
        things.push(cloud(random, x, groundAt(x, z) + range(random, 3, 34), z))
      }
    }
    // Trees on the hills.
    for (let i = count(random, 16, 24); i > 0; i--) {
      const x = side(random) * range(random, strip + 25, edge)
      const z = range(random, -half, half)
      things.push(tree(random, x, groundAt(x, z), z, range(random, 0.7, 1.15)).pieces)
    }
    // Sheep, mostly grazing the hillsides.
    for (let i = count(random, 10, 16); i > 0; i--) {
      const z = range(random, -half, half)
      const x = random() < 0.4 ? range(random, -strip, strip) : side(random) * range(random, strip - 5, strip + 130)
      things.push(sheep(random, x, groundAt(x, z), z))
    }
    // Flower patches.
    for (let i = count(random, 18, 26); i > 0; i--) {
      const z = range(random, -half, half)
      const x = random() < 0.5 ? range(random, -strip, strip) : side(random) * range(random, strip, strip + 120)
      things.push(flowers(random, x, groundAt(x, z), z))
    }
    return things
  },
}
