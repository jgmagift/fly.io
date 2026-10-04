export type Quality = 'high' | 'low'

/** The player's adjustments, kept between visits. */
export interface Settings {
  music: boolean
  sfx: boolean
  /** Low turns shadows off and renders fewer pixels, for phones that struggle. */
  quality: Quality
  /** Vibration on crashes and menu steps, where the device has it. */
  haptics: boolean
}

const STORAGE_KEY = 'fly.settings'
/** The single mute switch the game had before music and effects were separate. */
const OLD_MUTE_KEY = 'fly.muted'

export function loadSettings(): Settings {
  const settings: Settings = { music: true, sfx: true, quality: 'high', haptics: true }
  try {
    if (localStorage.getItem(OLD_MUTE_KEY) === '1') {
      settings.music = false
      settings.sfx = false
    }
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (saved && typeof saved === 'object') {
      const { music, sfx, quality, haptics } = saved as Partial<Settings>
      if (typeof music === 'boolean') settings.music = music
      if (typeof sfx === 'boolean') settings.sfx = sfx
      if (quality === 'high' || quality === 'low') settings.quality = quality
      if (typeof haptics === 'boolean') settings.haptics = haptics
    }
  } catch {
    // Storage is blocked or holds something unreadable: use the defaults.
  }
  return settings
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    localStorage.removeItem(OLD_MUTE_KEY)
  } catch {
    // Not remembering the settings is harmless.
  }
}
