import { formatScore } from './score'

interface HudHandlers {
  onMenu: () => void
  onToggleSound: () => void
  onCycleCamera: () => void
}

export interface RunSummary {
  score: number
  best: number
  isNewBest: boolean
  distance: number
}

/** Minimal DOM overlay. Only touches the DOM when a displayed value actually changes. */
export class Hud {
  private readonly statsEl: HTMLElement
  private readonly scoreEl: HTMLElement
  private readonly multiplierEl: HTMLElement
  private readonly speedEl: HTMLElement
  private readonly livesEl: HTMLElement
  private readonly hintEl: HTMLElement
  private readonly flashEl: HTMLElement
  private readonly gameOverEl: HTMLElement
  private readonly finalEl: HTMLElement
  private readonly bestEl: HTMLElement
  private readonly soundEl: HTMLElement
  private readonly camEl: HTMLElement
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
      </div>
      <div class="hud-buttons">
        <button class="hud-button" data-cam></button>
        <button class="hud-button" data-sound></button>
      </div>
      <div class="hud-hint" data-hint hidden>hold the left or right side of the screen to steer</div>
      <div class="hud-flash" data-flash></div>
      <div class="hud-gameover" data-gameover hidden>
        <div class="hud-gameover-title">GAME OVER</div>
        <div class="hud-gameover-score" data-final></div>
        <div class="hud-gameover-best" data-best></div>
        <div class="hud-gameover-hint">press space or tap to fly again</div>
        <button class="hud-menu-button" data-menu>change plane</button>
      </div>
    `
    const find = (selector: string) => root.querySelector<HTMLElement>(selector)!
    this.statsEl = find('[data-stats]')
    this.scoreEl = find('[data-score]')
    this.multiplierEl = find('[data-multiplier]')
    this.speedEl = find('[data-speed]')
    this.livesEl = find('[data-lives]')
    this.hintEl = find('[data-hint]')
    this.flashEl = find('[data-flash]')
    this.gameOverEl = find('[data-gameover]')
    this.finalEl = find('[data-final]')
    this.bestEl = find('[data-best]')
    this.soundEl = find('[data-sound]')
    this.camEl = find('[data-cam]')
    find('[data-menu]').addEventListener('click', handlers.onMenu)
    this.soundEl.addEventListener('click', () => {
      handlers.onToggleSound()
      this.soundEl.blur()
    })
    this.camEl.addEventListener('click', () => {
      handlers.onCycleCamera()
      this.camEl.blur()
    })
  }

  /** Show or hide the in-run readouts. The touch hint only appears during a run. */
  setRunVisible(visible: boolean, touched: boolean): void {
    this.statsEl.hidden = !visible
    this.hintEl.hidden = !(visible && this.showTouchHint && !touched)
  }

  setCamera(label: string): void {
    this.camEl.textContent = `CAM \u00b7 ${label}`
  }

  setSound(muted: boolean): void {
    this.soundEl.textContent = muted ? 'SOUND OFF' : 'SOUND ON'
    this.soundEl.setAttribute('aria-pressed', String(!muted))
  }

  update(score: number, multiplier: number, speed: number): void {
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
    this.gameOverEl.hidden = false
  }

  hideGameOver(): void {
    this.gameOverEl.hidden = true
  }

  hideHint(): void {
    this.hintEl.hidden = true
  }
}
