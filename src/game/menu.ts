import type { PlaneSpec } from './planes'
import { formatScore } from './score'
import type { WorldTheme } from './worlds'

interface MenuHandlers {
  onStep: (delta: number) => void
  onStepWorld: (delta: number) => void
  onPlay: () => void
  onEnterVR: () => void
}

const STAT_LABELS = [
  ['agility', 'AGILITY'],
  ['armor', 'ARMOR'],
  ['slim', 'SLIM'],
] as const

/** Title screen with the world and plane pickers. Both are shown live in the 3D scene behind it. */
export class Menu {
  private readonly root: HTMLElement
  private readonly nameEl: HTMLElement
  private readonly taglineEl: HTMLElement
  private readonly statsEl: HTMLElement
  private readonly dotsEl: HTMLElement
  private readonly bestEl: HTMLElement
  private readonly worldNameEl: HTMLElement
  private readonly worldTaglineEl: HTMLElement
  private readonly worldDotsEl: HTMLElement
  private readonly vrEl: HTMLElement
  private readonly vrNoteEl: HTMLElement
  private swipeStartX: number | null = null

  constructor(parent: HTMLElement, handlers: MenuHandlers) {
    this.root = document.createElement('div')
    this.root.className = 'menu'
    this.root.innerHTML = `
      <div class="menu-title">FLY.IO</div>
      <div class="menu-best" data-best></div>
      <div class="menu-spacer"></div>
      <div class="menu-world">
        <button class="menu-world-arrow" data-world-prev aria-label="Previous world">&#8249;</button>
        <div class="menu-world-body" aria-live="polite">
          <div class="menu-world-label">WORLD</div>
          <div class="menu-world-name" data-world-name></div>
          <div class="menu-world-tagline" data-world-tagline></div>
          <div class="menu-dots" data-world-dots></div>
        </div>
        <button class="menu-world-arrow" data-world-next aria-label="Next world">&#8250;</button>
      </div>
      <div class="menu-picker">
        <button class="menu-arrow" data-prev aria-label="Previous plane">&#8249;</button>
        <div class="menu-plane" aria-live="polite">
          <div class="menu-plane-name" data-name></div>
          <div class="menu-plane-tagline" data-tagline></div>
          <div class="menu-stats" data-stats></div>
          <div class="menu-dots" data-dots></div>
        </div>
        <button class="menu-arrow" data-next aria-label="Next plane">&#8250;</button>
      </div>
      <button class="menu-play" data-play>PLAY</button>
      <button class="menu-vr" data-vr hidden>PLAY IN VR</button>
      <div class="menu-vr-note" data-vr-note hidden></div>
      <div class="menu-keys">&larr; &rarr; or swipe for a plane &middot; &uarr; &darr; for a world &middot; space to fly &middot; C camera</div>
    `
    parent.appendChild(this.root)

    const find = (selector: string) => this.root.querySelector<HTMLElement>(selector)!
    this.nameEl = find('[data-name]')
    this.taglineEl = find('[data-tagline]')
    this.statsEl = find('[data-stats]')
    this.dotsEl = find('[data-dots]')
    this.bestEl = find('[data-best]')
    this.worldNameEl = find('[data-world-name]')
    this.worldTaglineEl = find('[data-world-tagline]')
    this.worldDotsEl = find('[data-world-dots]')
    find('[data-prev]').addEventListener('click', () => handlers.onStep(-1))
    find('[data-next]').addEventListener('click', () => handlers.onStep(1))
    find('[data-world-prev]').addEventListener('click', () => handlers.onStepWorld(-1))
    find('[data-world-next]').addEventListener('click', () => handlers.onStepWorld(1))
    find('[data-play]').addEventListener('click', () => handlers.onPlay())
    this.vrEl = find('[data-vr]')
    this.vrNoteEl = find('[data-vr-note]')
    this.vrEl.addEventListener('click', () => handlers.onEnterVR())

    // Swipe anywhere on the menu to change plane.
    this.root.addEventListener('pointerdown', (event) => {
      this.swipeStartX = event.clientX
    })
    this.root.addEventListener('pointerup', (event) => {
      if (this.swipeStartX === null) return
      const dx = event.clientX - this.swipeStartX
      this.swipeStartX = null
      if (Math.abs(dx) > 40) handlers.onStep(dx < 0 ? 1 : -1)
    })
  }

  setPlane(plane: PlaneSpec, index: number, count: number): void {
    this.nameEl.textContent = plane.name
    this.taglineEl.textContent = `${plane.tagline} · ${plane.lives} lives`
    this.statsEl.innerHTML = STAT_LABELS.map(([key, label]) => {
      let pips = ''
      for (let i = 1; i <= 5; i++) pips += `<span class="stat-pip${i <= plane.stats[key] ? ' on' : ''}"></span>`
      return `<div class="menu-stat"><span class="menu-stat-label">${label}</span><span class="menu-stat-pips">${pips}</span></div>`
    }).join('')
    this.dotsEl.innerHTML = dots(index, count)
  }

  setWorld(world: WorldTheme, index: number, count: number): void {
    this.worldNameEl.textContent = world.name
    this.worldTaglineEl.textContent = world.tagline
    this.worldDotsEl.innerHTML = dots(index, count)
  }

  /** Offer VR once the browser confirms a headset, or explain why it cannot start. */
  setVrStatus(status: 'available' | 'needs-https' | 'failed'): void {
    this.vrEl.hidden = status === 'needs-https'
    this.vrNoteEl.hidden = status === 'available'
    this.vrNoteEl.textContent =
      status === 'needs-https' ? 'VR needs a secure page. Open the https:// address of this game.' : 'VR could not start. Try again.'
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `BEST ${formatScore(best)}` : ''
  }

  show(): void {
    this.root.hidden = false
  }

  hide(): void {
    this.root.hidden = true
    // Drop focus so a later Space or Enter cannot re-trigger a hidden button.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }
}

/** A row of page dots with the current one lit. */
function dots(index: number, count: number): string {
  let html = ''
  for (let i = 0; i < count; i++) html += `<span class="menu-dot${i === index ? ' on' : ''}"></span>`
  return html
}
