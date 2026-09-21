const BEST_KEY = 'fly.best'

/** Best score so far, or 0. Storage can be blocked, so failures fall back quietly. */
export function loadBest(): number {
  try {
    const value = Number(localStorage.getItem(BEST_KEY))
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  } catch {
    return 0
  }
}

export function saveBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(Math.floor(score)))
  } catch {
    // Not being able to keep the high score is harmless.
  }
}

export function formatScore(score: number): string {
  return Math.floor(score).toLocaleString('en-US')
}
