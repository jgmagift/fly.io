import type { PlaneSpec } from './planes'
import { formatScore } from './score'
import type { Skin } from './skins'
import type { WorldTheme } from './worlds'

interface MenuHandlers {
  onStepPlane: (delta: number) => void
  onStepSkin: (delta: number) => void
  onStepWorld: (delta: number) => void
  onPlay: () => void
  onEnterVR: () => void
  onWatchAd: () => void
  onSettings: () => void
  onLeaderboard: () => void
}

/** What the main button does: fly, or unlock the plane or skin on show. */
export interface Offer {
  kind: 'play' | 'plane' | 'skin'
  price: number
  affordable: boolean
  /** Gems still missing when it is not affordable. */
  short: number
}

type Tab = 'plane' | 'skin' | 'world'

const TABS: readonly Tab[] = ['plane', 'skin', 'world']
const GEM = '◆'

const STAT_LABELS = [
  ['agility', 'AGILITY'],
  ['armor', 'ARMOR'],
  ['slim', 'SLIM'],
] as const

interface Choice<T> {
  item: T
  index: number
  count: number
  owned: boolean
}

/**
 * Title screen. The plane, its skin and the world are all shown live in the 3D scene, so the menu keeps
 * out of the way: a small header, and one card at the bottom that picks one thing at a time. Tabs choose
 * whether the card's arrows step through planes, skins or worlds.
 */
export class Menu {
  private readonly root: HTMLElement
  private readonly bestEl: HTMLElement
  private readonly gemsEl: HTMLElement
  private readonly tabEls: Record<Tab, HTMLElement>
  private readonly nameEl: HTMLElement
  private readonly priceEl: HTMLElement
  private readonly detailEl: HTMLElement
  private readonly statsEl: HTMLElement
  private readonly counterEl: HTMLElement
  private readonly playEl: HTMLElement
  private readonly adEl: HTMLElement
  private readonly vrEl: HTMLElement
  private readonly vrNoteEl: HTMLElement
  private readonly handlers: MenuHandlers
  private tab: Tab = 'plane'
  private plane: Choice<PlaneSpec> | null = null
  private skin: Choice<Skin> | null = null
  private world: Choice<WorldTheme> | null = null
  private swipeStartX: number | null = null

  constructor(parent: HTMLElement, handlers: MenuHandlers) {
    this.handlers = handlers
    this.root = document.createElement('div')
    this.root.className = 'menu'
    this.root.innerHTML = `
      <div class="menu-top">
        <div class="menu-brand">
          <h1 class="menu-title">FLY.IO</h1>
          <div class="menu-best" data-best></div>
        </div>
        <div class="menu-corner">
          <div class="menu-gems" data-gems aria-label="Gems"></div>
          <button class="menu-gear" data-leaderboard aria-label="Leaderboard"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg></button>
          <button class="menu-gear" data-settings aria-label="Settings"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button>
        </div>
      </div>
      <div class="menu-spacer"></div>
      <div class="menu-panel">
        <div class="menu-tabs" role="tablist">
          <button class="menu-tab" role="tab" data-tab="plane">PLANE</button>
          <button class="menu-tab" role="tab" data-tab="skin">SKIN</button>
          <button class="menu-tab" role="tab" data-tab="world">WORLD</button>
        </div>
        <div class="menu-card">
          <button class="menu-arrow" data-prev aria-label="Previous">&#8249;</button>
          <div class="menu-card-body" aria-live="polite">
            <div class="menu-name-row">
              <span class="menu-name" data-name></span>
              <span class="menu-price" data-price hidden></span>
            </div>
            <div class="menu-detail" data-detail></div>
            <div class="menu-stats" data-stats></div>
            <div class="menu-counter" data-counter></div>
          </div>
          <button class="menu-arrow" data-next aria-label="Next">&#8250;</button>
        </div>
        <button class="menu-ad" data-ad hidden></button>
        <button class="menu-play" data-play>PLAY</button>
        <button class="menu-vr" data-vr hidden>PLAY IN VR</button>
        <div class="menu-vr-note" data-vr-note hidden></div>
      </div>
    `
    parent.appendChild(this.root)

    const find = (selector: string) => this.root.querySelector<HTMLElement>(selector)!
    this.bestEl = find('[data-best]')
    this.gemsEl = find('[data-gems]')
    this.nameEl = find('[data-name]')
    this.priceEl = find('[data-price]')
    this.detailEl = find('[data-detail]')
    this.statsEl = find('[data-stats]')
    this.counterEl = find('[data-counter]')
    this.playEl = find('[data-play]')
    this.adEl = find('[data-ad]')
    this.vrEl = find('[data-vr]')
    this.vrNoteEl = find('[data-vr-note]')
    this.tabEls = { plane: find('[data-tab="plane"]'), skin: find('[data-tab="skin"]'), world: find('[data-tab="world"]') }
    for (const tab of TABS) this.tabEls[tab].addEventListener('click', () => this.setTab(tab))
    find('[data-prev]').addEventListener('click', () => this.step(-1))
    find('[data-next]').addEventListener('click', () => this.step(1))
    find('[data-settings]').addEventListener('click', () => handlers.onSettings())
    find('[data-leaderboard]').addEventListener('click', () => handlers.onLeaderboard())
    this.playEl.addEventListener('click', () => handlers.onPlay())
    this.adEl.addEventListener('click', () => handlers.onWatchAd())
    this.vrEl.addEventListener('click', () => handlers.onEnterVR())

    // Swipe anywhere on the menu to step through the open tab.
    this.root.addEventListener('pointerdown', (event) => {
      this.swipeStartX = event.clientX
    })
    this.root.addEventListener('pointerup', (event) => {
      if (this.swipeStartX === null) return
      const dx = event.clientX - this.swipeStartX
      this.swipeStartX = null
      if (Math.abs(dx) > 40) this.step(dx < 0 ? 1 : -1)
    })
    this.setTab('plane')
  }

  /** Step the open tab's choice: the next or previous plane, skin or world. */
  step(delta: number): void {
    if (this.tab === 'plane') this.handlers.onStepPlane(delta)
    else if (this.tab === 'skin') this.handlers.onStepSkin(delta)
    else this.handlers.onStepWorld(delta)
  }

  /** Move to the next or previous tab. */
  cycleTab(delta: number): void {
    this.setTab(TABS[(TABS.indexOf(this.tab) + delta + TABS.length) % TABS.length]!)
  }

  setPlane(plane: PlaneSpec, index: number, count: number, owned: boolean): void {
    this.plane = { item: plane, index, count, owned }
    if (this.tab === 'plane') this.render()
  }

  setSkin(skin: Skin, index: number, count: number, owned: boolean): void {
    this.skin = { item: skin, index, count, owned }
    if (this.tab === 'skin') this.render()
  }

  setWorld(world: WorldTheme, index: number, count: number): void {
    this.world = { item: world, index, count, owned: true }
    if (this.tab === 'world') this.render()
  }

  setGems(gems: number): void {
    this.gemsEl.textContent = `${GEM} ${formatScore(gems)}`
  }

  /** Label the main button: PLAY, or the price of the locked plane or skin on show. */
  setOffer(offer: Offer): void {
    this.playEl.classList.toggle('locked', offer.kind !== 'play')
    this.playEl.classList.toggle('short', offer.kind !== 'play' && !offer.affordable)
    this.playEl.textContent = offerLabel(offer)
  }

  /**
   * While rewarded ads halve the starting lives, say how many the next run gets and offer the ad.
   * `adVisible` is false when ads are off; `armed` once an ad has been watched for the next run.
   */
  setLives(lives: number, max: number, adVisible: boolean, armed: boolean): void {
    this.adEl.hidden = !adVisible
    this.adEl.toggleAttribute('disabled', armed)
    this.adEl.textContent = armed ? `FULL LIVES READY · ${max}` : `${lives} OF ${max} LIVES · WATCH AD FOR ALL`
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

  private setTab(tab: Tab): void {
    this.tab = tab
    for (const each of TABS) {
      this.tabEls[each].classList.toggle('on', each === tab)
      this.tabEls[each].setAttribute('aria-selected', String(each === tab))
    }
    this.render()
  }

  /** Fill the card for the open tab. */
  private render(): void {
    const choice = this.tab === 'plane' ? this.plane : this.tab === 'skin' ? this.skin : this.world
    if (!choice) return
    this.nameEl.textContent = choice.item.name
    this.counterEl.textContent = `${choice.index + 1} / ${choice.count}`

    const price = 'price' in choice.item ? choice.item.price : 0
    this.priceEl.hidden = choice.owned || price === 0
    this.priceEl.textContent = `${GEM} ${formatScore(price)}`

    this.statsEl.hidden = this.tab !== 'plane'
    if (this.tab === 'plane' && this.plane) {
      const plane = this.plane.item
      this.detailEl.textContent = `${plane.tagline} · ${plane.lives} lives`
      this.statsEl.innerHTML = STAT_LABELS.map(([key, label]) => {
        let pips = ''
        for (let i = 1; i <= 5; i++) pips += `<span class="stat-pip${i <= plane.stats[key] ? ' on' : ''}"></span>`
        return `<div class="menu-stat"><span class="menu-stat-label">${label}</span><span class="menu-stat-pips">${pips}</span></div>`
      }).join('')
    } else if (this.tab === 'skin' && this.skin) {
      this.detailEl.textContent = this.skin.item.price === 0 ? 'Each plane in its own colours' : 'A paint job that fits every plane'
    } else if (this.world) {
      this.detailEl.textContent = this.world.item.tagline
    }
  }
}

export function offerLabel(offer: Offer): string {
  if (offer.kind === 'play') return 'PLAY'
  const what = offer.kind === 'skin' ? 'SKIN ' : ''
  return offer.affordable
    ? `UNLOCK ${what}${GEM} ${formatScore(offer.price)}`
    : `${GEM} ${formatScore(offer.price)} · ${formatScore(offer.short)} SHORT`
}
