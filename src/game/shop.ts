import { PLANES } from './planes'
import type { PlaneSpec } from './planes'
import { SKINS } from './skins'
import type { Skin } from './skins'

const GEMS_KEY = 'fly.gems'
const PLANES_KEY = 'fly.owned'
const SKINS_KEY = 'fly.skins'
const UPDATED_KEY = 'fly.walletAt'
/** Where the plane picker remembers its choice. Read once, to let earlier players keep the plane they flew. */
const LAST_PLANE_KEY = 'fly.plane'

/**
 * The player's gems and what they have unlocked with them. Gems are picked up in runs and spent on
 * planes and skins. Everything is kept in local storage; when storage is blocked the wallet simply
 * starts empty each visit.
 */
export class Shop {
  gems = 0
  /** When the wallet last changed on this device, in milliseconds since 1970, or 0 for a new wallet. */
  updatedAt = 0
  private readonly planes = new Set<string>([PLANES[0]!.id])
  private readonly skins = new Set<string>([SKINS[0]!.id])

  constructor() {
    try {
      const gems = Number(localStorage.getItem(GEMS_KEY))
      if (Number.isFinite(gems) && gems > 0) this.gems = Math.floor(gems)
      const updatedAt = Number(localStorage.getItem(UPDATED_KEY))
      if (Number.isFinite(updatedAt) && updatedAt > 0) this.updatedAt = updatedAt
      const owned = localStorage.getItem(PLANES_KEY)
      if (owned === null) {
        // First visit since planes had prices: whoever already picked a plane keeps it.
        const last = localStorage.getItem(LAST_PLANE_KEY)
        if (last && PLANES.some((plane) => plane.id === last)) this.planes.add(last)
        this.save(false)
      } else {
        for (const id of parseIds(owned)) this.planes.add(id)
      }
      for (const id of parseIds(localStorage.getItem(SKINS_KEY))) this.skins.add(id)
    } catch {
      // Storage is blocked: play on with the free plane and skin.
    }
  }

  ownsPlane(plane: PlaneSpec): boolean {
    return plane.price === 0 || this.planes.has(plane.id)
  }

  ownsSkin(skin: Skin): boolean {
    return skin.price === 0 || this.skins.has(skin.id)
  }

  ownedPlanes(): string[] {
    return [...this.planes]
  }

  ownedSkins(): string[] {
    return [...this.skins]
  }

  /**
   * Fold in a backup from the cloud. Unlocks are combined; the gem count comes from whichever copy
   * changed last. Returns whether anything here changed.
   */
  merge(backup: { gems: number; planes: string[]; skins: string[]; updatedAt: number }): boolean {
    const before = `${this.gems}|${this.planes.size}|${this.skins.size}`
    for (const id of backup.planes) if (PLANES.some((plane) => plane.id === id)) this.planes.add(id)
    for (const id of backup.skins) if (SKINS.some((skin) => skin.id === id)) this.skins.add(id)
    if (backup.updatedAt > this.updatedAt) this.gems = Math.max(0, Math.floor(backup.gems))
    const changed = `${this.gems}|${this.planes.size}|${this.skins.size}` !== before
    if (changed) this.save()
    return changed
  }

  addGems(count: number): void {
    if (count <= 0) return
    this.gems += count
    this.save()
  }

  /** Spend gems on a plane. False if there are not enough. */
  buyPlane(plane: PlaneSpec): boolean {
    if (this.ownsPlane(plane)) return true
    if (this.gems < plane.price) return false
    this.gems -= plane.price
    this.planes.add(plane.id)
    this.save()
    return true
  }

  /** Spend gems on a skin. False if there are not enough. */
  buySkin(skin: Skin): boolean {
    if (this.ownsSkin(skin)) return true
    if (this.gems < skin.price) return false
    this.gems -= skin.price
    this.skins.add(skin.id)
    this.save()
    return true
  }

  /** Write the wallet to local storage. `stamp` marks it as changed now, which the cloud merge compares. */
  private save(stamp = true): void {
    if (stamp) this.updatedAt = Date.now()
    try {
      localStorage.setItem(UPDATED_KEY, String(this.updatedAt))
      localStorage.setItem(GEMS_KEY, String(this.gems))
      localStorage.setItem(PLANES_KEY, JSON.stringify([...this.planes]))
      localStorage.setItem(SKINS_KEY, JSON.stringify([...this.skins]))
    } catch {
      // Not being able to keep the wallet is harmless to the run in progress.
    }
  }
}

function parseIds(value: string | null): string[] {
  if (!value) return []
  try {
    const ids: unknown = JSON.parse(value)
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}
