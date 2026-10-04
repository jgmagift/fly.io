/** A paint job. `null` colours keep the plane's own. Skins are bought once and fit every plane. */
export interface Skin {
  id: string
  name: string
  /** Gems to unlock. */
  price: number
  hull: number | null
  accent: number | null
  trail: number | null
}

/** Ordered from cheap to dear. The first is free and is each plane's factory colours. */
export const SKINS: readonly Skin[] = [
  { id: 'stock', name: 'STOCK', price: 0, hull: null, accent: null, trail: null },
  { id: 'ember', name: 'EMBER', price: 150, hull: 0xe0572f, accent: 0x2a2a2e, trail: 0xffa26b },
  { id: 'midnight', name: 'MIDNIGHT', price: 200, hull: 0x1b1f3b, accent: 0x7df9ff, trail: 0x7df9ff },
  { id: 'mint', name: 'MINT', price: 250, hull: 0x9be8c8, accent: 0xffffff, trail: 0xc9ffe9 },
  { id: 'rose', name: 'ROSE', price: 300, hull: 0xf78fb3, accent: 0xfff4d6, trail: 0xffc2d6 },
  { id: 'cobalt', name: 'COBALT', price: 400, hull: 0x2f6fed, accent: 0xffd60a, trail: 0x8ab4ff },
  { id: 'violet', name: 'VIOLET', price: 500, hull: 0x8e5cf7, accent: 0xffe66d, trail: 0xd0b3ff },
  { id: 'ghost', name: 'GHOST', price: 750, hull: 0xf8f9fa, accent: 0xb8c0cc, trail: 0xffffff },
  { id: 'gold', name: 'GOLD', price: 1500, hull: 0xffc233, accent: 0xfff4d6, trail: 0xffe08a },
]

const STORAGE_KEY = 'fly.skin'

/** Index of the skin chosen last time, or 0. Storage can be blocked, so failures fall back quietly. */
export function loadSkinIndex(): number {
  try {
    const index = SKINS.findIndex((skin) => skin.id === localStorage.getItem(STORAGE_KEY))
    return index < 0 ? 0 : index
  } catch {
    return 0
  }
}

export function saveSkinIndex(index: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, SKINS[index]!.id)
  } catch {
    // Not being able to remember the choice is harmless.
  }
}
