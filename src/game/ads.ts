/**
 * Rewarded ads. When they are switched on, a run starts with half the plane's lives and watching
 * an ad restores the full count for the next run. With them off, every run has full lives.
 */
export interface RewardedAds {
  /** Whether rewarded ads are set up at all. Lives are only halved when they are. */
  readonly enabled: boolean
  /** Whether an ad is loaded and can be shown right now. */
  ready(): boolean
  /** Show an ad. Resolves true only if the player earned the reward. */
  show(): Promise<boolean>
}

export const ads: RewardedAds = {
  enabled: false,
  ready: () => false,
  show: () => Promise.resolve(false),
}

/** Lives a run starts with. */
export function startingLives(planeLives: number, fullLives: boolean): number {
  return ads.enabled && !fullLives ? Math.ceil(planeLives / 2) : planeLives
}
