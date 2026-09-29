import { WORLD } from './constants'
import { fbm, smoothstep } from './noise'

/** The shape of a world's hills. Distances from the edge of the flyable strip, heights in world units. */
export interface TerrainProfile {
  /** Hills begin this far outside the strip and reach full height this far outside it. */
  hillStart: number
  hillFull: number
  hillHeight: number
  detailHeight: number
  /** Extra height along the far edges of each chunk. */
  ridgeHeight: number
  /** Horizontal size of the hills and of the finer detail on them. */
  hillScale: number
  detailScale: number
}

/**
 * Landscape height at a world position. Flat inside the flyable strip so collisions stay simple,
 * rolling hills just outside it and a ridge along the far edges of each chunk.
 * `worldZ` grows with distance flown; it must be the same value on both sides of a chunk border.
 */
export function terrainHeight(x: number, worldZ: number, profile: TerrainProfile): number {
  const ax = Math.abs(x)
  const hillMask = smoothstep(WORLD.playHalfWidth + profile.hillStart, WORLD.playHalfWidth + profile.hillFull, ax)
  if (hillMask <= 0) return 0
  const hills = fbm(x / profile.hillScale, worldZ / profile.hillScale, 3, WORLD.seed) * profile.hillHeight
  const detail = (fbm(x / profile.detailScale, worldZ / profile.detailScale, 2, WORLD.seed + 7) - 0.5) * profile.detailHeight
  const ridge = smoothstep(WORLD.playHalfWidth + 140, WORLD.chunkWidth / 2, ax) * profile.ridgeHeight
  return Math.max(0, hillMask * (hills + detail + ridge))
}
