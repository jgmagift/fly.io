import type { SupabaseClient } from '@supabase/supabase-js'

/** The Supabase project behind player names, saved progress and the leaderboard. This key is the public one. */
const SUPABASE_URL = 'https://gnxgytjyeevbnjfcnuiy.supabase.co'
const SUPABASE_KEY = 'sb_publishable_DxivhqQzIwBCjb6lQrjjDA_aqYrQ1RE'
/** Progress is saved this long after the last change, so a burst of changes is one request. */
const SAVE_DELAY_MS = 2000

export interface Profile {
  id: string
  name: string
  /** Two-letter country, from the player's connection when the profile was made. */
  country: string | null
  /** False while the player still has their generated name. */
  renamed: boolean
}

export interface LeaderRow {
  rank: number
  name: string
  country: string | null
  score: number
  plane: string
  world: string
  isMe: boolean
}

/** What is backed up: the wallet, unlocks, best score and current picks. */
export interface Progress {
  gems: number
  planes: string[]
  skins: string[]
  best: number
  plane: string
  skin: string
  world: string
  /** When it last changed, in milliseconds since 1970. */
  updatedAt: number
}

export type RenameResult = { ok: true } | { ok: false; reason: 'invalid' | 'taken' | 'offline' }

/**
 * Player accounts, saved progress and the worldwide leaderboard, in Supabase. Nobody signs up: the first
 * launch signs in anonymously, and the server names the player and notes their country. Everything is
 * best effort. Offline, the game plays on from local storage and catches up on a later save.
 */
export class Cloud {
  profile: Profile | null = null
  private client: Promise<SupabaseClient> | null = null
  private starting: Promise<Profile | null> | null = null
  private readonly listeners = new Set<() => void>()
  private pending: Progress | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  /** Sign in, anonymously the first time, and load the profile. Safe to call often; a failure is retried next call. */
  start(): Promise<Profile | null> {
    this.starting ??= this.signIn().then((profile) => {
      if (!profile) this.starting = null
      return profile
    })
    return this.starting
  }

  /** For React's useSyncExternalStore and the web panels: called whenever the profile changes. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getProfile = (): Profile | null => this.profile

  /** The backup saved from this player's devices, or null if there is none or the cloud is out of reach. */
  async loadProgress(): Promise<Progress | null> {
    if (!(await this.start())) return null
    try {
      const { data, error } = await (await this.db()).from('progress').select('*').maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        gems: data.gems,
        planes: data.planes,
        skins: data.skins,
        best: data.best,
        plane: data.plane ?? '',
        skin: data.skin ?? '',
        world: data.world ?? '',
        updatedAt: Date.parse(data.updated_at),
      }
    } catch (error) {
      console.warn('Loading progress failed', error)
      return null
    }
  }

  /** Back the progress up soon. Calls within SAVE_DELAY_MS of each other send only the last. */
  saveProgress(progress: Progress): void {
    this.pending = progress
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY_MS)
  }

  /** Send a waiting backup now, for when the app is about to close. If it fails, the next save retries. */
  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const progress = this.pending
    if (!progress) return
    this.pending = null
    const profile = await this.start()
    try {
      if (!profile) throw new Error('offline')
      const { error } = await (await this.db()).from('progress').upsert({
        user_id: profile.id,
        gems: progress.gems,
        planes: progress.planes,
        skins: progress.skins,
        best: progress.best,
        plane: progress.plane,
        skin: progress.skin,
        world: progress.world,
        updated_at: new Date(progress.updatedAt).toISOString(),
      })
      if (error) throw error
    } catch (error) {
      // Keep it for the next save, unless something newer is already waiting.
      this.pending ??= progress
      if (profile) console.warn('Saving progress failed', error)
    }
  }

  /** Put a finished run on the leaderboard. Returns the player's best score and its worldwide rank. */
  async submitScore(run: { score: number; distance: number; world: string; plane: string }): Promise<{ best: number; rank: number } | null> {
    if (!(await this.start())) return null
    try {
      const { data, error } = await (await this.db()).rpc('submit_score', {
        p_score: Math.floor(run.score),
        p_distance: Math.ceil(run.distance),
        p_world: run.world,
        p_plane: run.plane,
      })
      if (error) throw error
      const row = (data as { best: number; rank: number }[])[0]
      return row ? { best: row.best, rank: Number(row.rank) } : null
    } catch (error) {
      console.warn('Submitting the score failed', error)
      return null
    }
  }

  /** The top 50 worldwide, or in one country. The player's own row is added at the end when they are further down. */
  async leaderboard(country: string | null = null): Promise<LeaderRow[] | null> {
    if (!(await this.start())) return null
    try {
      const { data, error } = await (await this.db()).rpc('leaderboard', { p_country: country, p_limit: 50 })
      if (error) throw error
      return (data as (Omit<LeaderRow, 'isMe'> & { is_me: boolean })[]).map((row) => ({
        rank: Number(row.rank),
        name: row.name,
        country: row.country,
        score: row.score,
        plane: row.plane,
        world: row.world,
        isMe: row.is_me,
      }))
    } catch (error) {
      console.warn('Loading the leaderboard failed', error)
      return null
    }
  }

  /** Change the player's name: 3 to 16 letters, digits or underscores, not taken by anyone else. */
  async rename(name: string): Promise<RenameResult> {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return { ok: false, reason: 'invalid' }
    if (!(await this.start())) return { ok: false, reason: 'offline' }
    try {
      const { data, error } = await (await this.db()).rpc('set_name', { p_name: name })
      if (error) {
        if (error.message === 'name_taken') return { ok: false, reason: 'taken' }
        if (error.message === 'name_invalid') return { ok: false, reason: 'invalid' }
        throw error
      }
      this.setProfile(data as Profile)
      return { ok: true }
    } catch (error) {
      console.warn('Renaming failed', error)
      return { ok: false, reason: 'offline' }
    }
  }

  /** Call one of the project's database functions as the signed-in player. False if it could not be done. */
  async call(fn: string, args: Record<string, unknown>): Promise<boolean> {
    if (!(await this.start())) return false
    const { error } = await (await this.db()).rpc(fn, args)
    if (error) console.warn(`${fn} failed`, error)
    return !error
  }

  private async signIn(retry = true): Promise<Profile | null> {
    try {
      const db = await this.db()
      const { data } = await db.auth.getSession()
      if (!data.session) {
        const { error } = await db.auth.signInAnonymously()
        if (error) throw error
      }
      const { data: profile, error } = await db.rpc('ensure_profile')
      if (error) {
        // The saved session belongs to a player who no longer exists: start over as a new one.
        if (retry && (error.code === '23503' || error.code === 'PGRST301')) {
          await db.auth.signOut({ scope: 'local' })
          return this.signIn(false)
        }
        throw error
      }
      this.setProfile(profile as Profile)
      return this.profile
    } catch (error) {
      console.warn('Signing in to the cloud failed', error)
      return null
    }
  }

  private setProfile(profile: Profile): void {
    this.profile = { id: profile.id, name: profile.name, country: profile.country, renamed: profile.renamed }
    for (const listener of this.listeners) listener()
  }

  /** The Supabase client, loaded on first use so the game itself starts without waiting for it. */
  private db(): Promise<SupabaseClient> {
    this.client ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          storage: localStorageOrNothing(),
          storageKey: 'fly.auth',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      }),
    )
    return this.client
  }
}

export const cloud = new Cloud()

/** A flag emoji for a two-letter country code. */
export function flag(country: string | null): string {
  if (!country || !/^[A-Z]{2}$/.test(country)) return '\u{1F3F3}'
  return String.fromCodePoint(...[...country].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65))
}

/** The country's English name where the platform knows it, or its code. */
export function countryName(country: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(country) ?? country
  } catch {
    return country
  }
}

function localStorageOrNothing(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    // Blocked storage throws on access. The session then lasts only as long as the page.
    return undefined
  }
}
