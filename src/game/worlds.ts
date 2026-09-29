import { Color } from 'three'
import { WORLD } from './constants'
import { fbm, smoothstep } from './noise'
import { monoliths, village } from './scenery'
import type { Scenery } from './scenery'
import type { TerrainProfile } from './terrain'

export interface WorldPalette {
  skyZenith: number
  skyUpper: number
  skyLower: number
  skyHorizon: number
  sunDisc: number
  sunGlow: number
  /** Also the page background and the colour the far ground fades into, so it should match the horizon. */
  fog: number
  sunLight: number
  hemiSky: number
  hemiGround: number
}

/** Everything that makes one world look and feel like itself. The flying is the same in all of them. */
export interface WorldTheme {
  id: string
  name: string
  tagline: string
  palette: WorldPalette
  /** From the ship toward the sun. Low for long dusk shadows, high for a bright day. */
  sunDirection: readonly [number, number, number]
  sunIntensity: number
  ambientIntensity: number
  fogNear: number
  fogFar: number
  terrain: TerrainProfile
  /** Ground colour at a world position, written into `out`. */
  groundColor(x: number, worldZ: number, out: Color): void
  scenery: Scenery
}

const SAND = 0xcdb394
const LIME = new Color(0x9be052)
const TEAL = new Color(0x4fb286)

export const WORLDS: readonly WorldTheme[] = [
  {
    id: 'dusk',
    name: 'DUSK',
    tagline: 'Sunset sands and black monoliths',
    palette: {
      skyZenith: 0x2b3766,
      skyUpper: 0x7f5f95,
      skyLower: 0xe0836f,
      skyHorizon: 0xf6b57d,
      sunDisc: 0xfff4d6,
      sunGlow: 0xffd39a,
      fog: 0xf6b57d,
      sunLight: 0xffb474,
      hemiSky: 0x7c72ad,
      hemiGround: 0x6e5643,
    },
    sunDirection: [-0.33, 0.19, -0.92],
    sunIntensity: 2.8,
    ambientIntensity: 1.3,
    fogNear: 140,
    fogFar: 540,
    terrain: { hillStart: 15, hillFull: 110, hillHeight: 55, detailHeight: 12, ridgeHeight: 40, hillScale: 150, detailScale: 45 },
    groundColor: (_x, _z, out) => {
      out.setHex(SAND)
    },
    scenery: monoliths,
  },
  {
    id: 'meadow',
    name: 'MEADOW',
    tagline: 'Cloud meadows, cottages and sheep',
    palette: {
      skyZenith: 0x3b8fe8,
      skyUpper: 0x6db6f2,
      skyLower: 0xa9d8f8,
      skyHorizon: 0xdff2ff,
      sunDisc: 0xfffdf0,
      sunGlow: 0xfff3c2,
      fog: 0xdff2ff,
      sunLight: 0xfff4dc,
      hemiSky: 0xcfe9ff,
      hemiGround: 0x86bf66,
    },
    // High and behind the player, so the faces they see are the lit ones. Dusk lights from ahead for long shadows.
    sunDirection: [0.4, 0.85, 0.35],
    sunIntensity: 1.9,
    ambientIntensity: 1.1,
    fogNear: 150,
    fogFar: 560,
    terrain: { hillStart: 10, hillFull: 90, hillHeight: 34, detailHeight: 7, ridgeHeight: 26, hillScale: 170, detailScale: 55 },
    // Bright grass with darker patches drifting across it, like cloud shadows that never move.
    groundColor: (x, z, out) => {
      const patch = smoothstep(0.5, 0.6, fbm(x / 60, z / 60, 2, WORLD.seed + 31))
      out.copy(LIME).lerp(TEAL, patch)
    },
    scenery: village,
  },
]

const STORAGE_KEY = 'fly.world'

/** Index of the world chosen last time, or 0. Storage can be blocked, so failures fall back quietly. */
export function loadWorldIndex(): number {
  try {
    const index = WORLDS.findIndex((world) => world.id === localStorage.getItem(STORAGE_KEY))
    return index < 0 ? 0 : index
  } catch {
    return 0
  }
}

export function saveWorldIndex(index: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, WORLDS[index]!.id)
  } catch {
    // Not being able to remember the choice is harmless.
  }
}
