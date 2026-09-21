import { WORLD } from './constants'
import { fbm, smoothstep } from './noise'

/**
 * Landscape height at a world position. Flat inside the flyable strip so collisions stay simple,
 * rolling hills just outside it and a ridge along the far edges of each chunk.
 * `worldZ` grows with distance flown; it must be the same value on both sides of a chunk border.
 */
export function terrainHeight(x: number, worldZ: number): number {
  const ax = Math.abs(x)
  const hillMask = smoothstep(WORLD.playHalfWidth + 15, WORLD.playHalfWidth + 110, ax)
  if (hillMask <= 0) return 0
  const hills = fbm(x / 150, worldZ / 150, 3, WORLD.seed) * 55
  const detail = (fbm(x / 45, worldZ / 45, 2, WORLD.seed + 7) - 0.5) * 12
  const ridge = smoothstep(WORLD.playHalfWidth + 140, WORLD.chunkWidth / 2, ax) * 40
  return Math.max(0, hillMask * (hills + detail + ridge))
}
