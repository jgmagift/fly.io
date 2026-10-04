import { formatScore } from './score'

interface HudHandlers {
  onMenu: () => void
  onSettings: () => void
  onPause: () => void
  onResume: () => void
  onQuit: () => void
  onWatchAd: () => void
}

export interface RunSummary {
  score: number
  best: number
  isNewBest: boolean
  distance: number
  /** Gems picked up in the run. */
  gems: number
}

/** Plural-free rank label, for the game over screen and the VR board. */
export function rankLabel(rank: number): string {
  return `WORLD RANK #${rank.toLocaleString('en-US')}`
}

/** Minimal DOM overlay. Only touches the DOM when a displayed value actually changes. */
export class Hud {
  private readonly statsEl: HTMLElement
  private readonly scoreEl: HTMLElement
  private readonly multiplierEl: HTMLElement
  private readonly speedEl: HTMLElement
  private readonly livesEl: HTMLElement
  private readonly gemsEl: HTMLElement
  private readonly earnedEl: HTMLElement
  private readonly rankEl: HTMLElement
  private readonly adEl: HTMLElement
  private lastGems = -1
  private readonly hintEl: HTMLElement
  private readonly flashEl: HTMLElement
  private readonly gameOverEl: HTMLElement
  private readonly finalEl: HTMLElement
  private readonly bestEl: HTMLElement
  private readonly pauseButtonEl: HTMLElement
  private readonly pauseEl: HTMLElement
  private readonly pauseTitleEl: HTMLElement
  private readonly pauseActionsEl: HTMLElement
  private readonly pauseHintEl: HTMLElement
  private countdownStep = -1
  private readonly showTouchHint: boolean
  private lastScore = -1
  private lastMultiplier = -1
  private lastSpeed = -1
  private lastLives = ''

  constructor(root: HTMLElement, showTouchHint: boolean, handlers: HudHandlers) {
    this.showTouchHint = showTouchHint
    root.innerHTML = `
      <div class="hud-stats" data-stats hidden>
        <div class="hud-row">
          <span class="hud-label">SCORE</span><span class="hud-value" data-score>0</span>
          <span class="hud-multiplier" data-multiplier>x1</span>
        </div>
        <div class="hud-row"><span class="hud-label">SPEED</span><span class="hud-value" data-speed>0</span></div>
        <div class="hud-row"><span class="hud-label">LIVES</span><span class="hud-lives" data-lives></span></div>
        <div class="hud-row"><span class="hud-label">GEMS</span><span class="hud-gems" data-gems>&#9670; 0</span></div>
      </div>
      <div class="hud-buttons">
        <button class="hud-button" data-pause-button hidden>PAUSE</button>
      </div>
      <div class="hud-hint" data-hint hidden>hold the left or right side of the screen to steer</div>
      <div class="hud-flash" data-flash></div>
      <div class="hud-pause" data-pause hidden>
        <div class="hud-gameover-title" data-pause-title>PAUSED</div>
        <div class="hud-pause-actions" data-pause-actions>
          <button class="hud-menu-button" data-resume>resume</button>
          <button class="hud-menu-button" data-settings>settings</button>
          <button class="hud-menu-button" data-quit>quit to menu</button>
        </div>
        <div class="hud-gameover-hint" data-pause-hint>tap, space or P to resume &middot; Q to quit</div>
      </div>
      <div class="hud-gameover" data-gameover hidden>
        <div class="hud-gameover-title">GAME OVER</div>
        <div class="hud-gameover-score" data-final></div>
        <div class="hud-gameover-best" data-best></div>
        <div class="hud-gameover-gems" data-earned></div>
        <div class="hud-gameover-rank" data-rank></div>
        <div class="hud-gameover-hint">press space or tap to fly again</div>
        <button class="hud-menu-button" data-ad hidden>watch ad &middot; full lives</button>
        <button class="hud-menu-button" data-menu>change plane</button>
      </div>
    `
    const find = (selector: string) => root.querySelector<HTMLElement>(selector)!
    this.statsEl = find('[data-stats]')
    this.scoreEl = find('[data-score]')
    this.multiplierEl = find('[data-multiplier]')
    this.speedEl = find('[data-speed]')
    this.livesEl = find('[data-lives]')
    this.gemsEl = find('[data-gems]')
    this.earnedEl = find('[data-earned]')
    this.rankEl = find('[data-rank]')
    this.adEl = find('[data-ad]')
    this.adEl.addEventListener('click', handlers.onWatchAd)
    this.hintEl = find('[data-hint]')
    this.flashEl = find('[data-flash]')
    this.gameOverEl = find('[data-gameover]')
    this.finalEl = find('[data-final]')
    this.bestEl = find('[data-best]')
    this.pauseButtonEl = find('[data-pause-button]')
    this.pauseEl = find('[data-pause]')
    this.pauseTitleEl = find('[data-pause-title]')
    this.pauseActionsEl = find('[data-pause-actions]')
    this.pauseHintEl = find('[data-pause-hint]')
    find('[data-resume]').addEventListener('click', handlers.onResume)
    find('[data-quit]').addEventListener('click', handlers.onQuit)
    find('[data-settings]').addEventListener('click', handlers.onSettings)
    this.pauseButtonEl.addEventListener('click', () => {
      handlers.onPause()
      this.pauseButtonEl.blur()
    })
    find('[data-menu]').addEventListener('click', handlers.onMenu)
  }

  /** Show or hide the in-run readouts. The touch hint only appears during a run. */
  setRunVisible(visible: boolean, touched: boolean): void {
    this.statsEl.hidden = !visible
    this.hintEl.hidden = !(visible && this.showTouchHint && !touched)
  }

  /** The PAUSE button only shows during a run. */
  setPauseButton(visible: boolean): void {
    this.pauseButtonEl.hidden = !visible
  }

  showPause(): void {
    this.countdownStep = -1
    this.pauseEl.hidden = false
    this.pauseEl.classList.remove('counting')
    this.pauseTitleEl.textContent = 'PAUSED'
    this.pauseActionsEl.hidden = false
    this.pauseHintEl.hidden = false
  }

  /** Big 3, 2, 1 before play resumes. Only touches the DOM when the number changes. */
  showCountdown(step: number): void {
    if (step === this.countdownStep) return
    this.countdownStep = step
    this.pauseEl.hidden = false
    this.pauseEl.classList.add('counting')
    this.pauseTitleEl.textContent = String(step)
    this.pauseActionsEl.hidden = true
    this.pauseHintEl.hidden = true
  }

  hidePause(): void {
    this.pauseEl.hidden = true
  }

  update(score: number, multiplier: number, speed: number, gems: number): void {
    if (gems !== this.lastGems) {
      this.lastGems = gems
      this.gemsEl.textContent = `\u25c6 ${gems}`
    }
    const points = Math.floor(score)
    if (points !== this.lastScore) {
      this.lastScore = points
      this.scoreEl.textContent = formatScore(points)
    }
    if (multiplier !== this.lastMultiplier) {
      // Pulse when the multiplier climbs, not when a crash knocks it back down.
      const climbed = multiplier > this.lastMultiplier && this.lastMultiplier > 0
      this.lastMultiplier = multiplier
      this.multiplierEl.textContent = `x${multiplier}`
      this.multiplierEl.classList.remove('pulse')
      if (climbed) {
        void this.multiplierEl.offsetWidth
        this.multiplierEl.classList.add('pulse')
      }
    }
    const s = Math.round(speed)
    if (s !== this.lastSpeed) {
      this.lastSpeed = s
      this.speedEl.textContent = String(s)
    }
  }

  setLives(lives: number, max: number): void {
    const key = `${lives}/${max}`
    if (key === this.lastLives) return
    this.lastLives = key
    let pips = ''
    for (let i = 0; i < max; i++) pips += `<span class="pip${i < lives ? '' : ' lost'}"></span>`
    this.livesEl.innerHTML = pips
    this.livesEl.setAttribute('aria-label', `${lives} of ${max} lives`)
  }

  /** Brief red flash on impact. Restarts cleanly even if the last flash is still fading. */
  flash(): void {
    this.flashEl.classList.remove('active')
    void this.flashEl.offsetWidth
    this.flashEl.classList.add('active')
  }

  showGameOver(run: RunSummary): void {
    this.finalEl.textContent = formatScore(run.score)
    this.bestEl.textContent = run.isNewBest
      ? `NEW BEST · ${Math.floor(run.distance)} m flown`
      : `best ${formatScore(run.best)} · ${Math.floor(run.distance)} m flown`
    this.bestEl.classList.toggle('new', run.isNewBest)
    this.earnedEl.textContent = `+${run.gems} \u25c6`
    this.rankEl.textContent = ''
    this.gameOverEl.hidden = false
  }

  /** Show where the player's best stands worldwide, once the leaderboard answers. */
  showRank(rank: number): void {
    this.rankEl.textContent = rankLabel(rank)
  }

  /** Offer the rewarded ad on the game over screen, or say that full lives are ready. */
  setAdOffer(visible: boolean, armed: boolean): void {
    this.adEl.hidden = !visible
    this.adEl.textContent = armed ? 'full lives ready' : 'watch ad \u00b7 full lives'
    this.adEl.toggleAttribute('disabled', armed)
  }

  hideGameOver(): void {
    this.gameOverEl.hidden = true
  }

  hideHint(): void {
    this.hintEl.hidden = true
  }
}
