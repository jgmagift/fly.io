import { cloud, countryName, flag } from './cloud'
import type { LeaderRow } from './cloud'
import { formatScore } from './score'

type Scope = 'world' | 'country'

const RENAME_ERRORS = {
  invalid: '3 to 16 letters, digits or _',
  taken: 'That name is taken',
  offline: 'No connection. Try again.',
} as const

/**
 * The worldwide leaderboard, opened from the trophy on the menu. The player's own name sits at the top
 * with a rename button; tabs switch between the whole world and the player's country.
 */
export class LeaderboardPanel {
  private readonly root: HTMLElement
  private readonly nameEl: HTMLElement
  private readonly viewEl: HTMLElement
  private readonly formEl: HTMLFormElement
  private readonly inputEl: HTMLInputElement
  private readonly errorEl: HTMLElement
  private readonly countryTabEl: HTMLElement
  private readonly worldTabEl: HTMLElement
  private readonly listEl: HTMLElement
  private readonly statusEl: HTMLElement
  private scope: Scope = 'world'
  /** Bumped on every load, so a slow answer for an old tab is thrown away. */
  private request = 0

  constructor(parent: HTMLElement, onClose: () => void) {
    this.root = document.createElement('div')
    this.root.className = 'settings'
    this.root.hidden = true
    this.root.innerHTML = `
      <div class="settings-sheet board" role="dialog" aria-label="Leaderboard">
        <div class="settings-title">LEADERBOARD</div>
        <div class="board-me" data-view>
          <span class="board-me-label">YOU</span>
          <span class="board-me-name" data-name></span>
          <button class="board-link" data-rename>RENAME</button>
        </div>
        <form class="board-me" data-form hidden>
          <input class="board-input" data-input maxlength="16" autocomplete="off" spellcheck="false" aria-label="New name" />
          <button class="board-link" type="submit">SAVE</button>
          <button class="board-link" type="button" data-cancel>CANCEL</button>
        </form>
        <div class="board-error" data-error></div>
        <div class="menu-tabs board-tabs" role="tablist">
          <button class="menu-tab on" role="tab" data-scope="world">WORLD</button>
          <button class="menu-tab" role="tab" data-scope="country" hidden></button>
        </div>
        <ol class="board-list" data-list></ol>
        <div class="board-status" data-status></div>
        <button class="settings-close" data-close>DONE</button>
      </div>
    `
    parent.appendChild(this.root)
    const find = <T extends HTMLElement = HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!
    this.nameEl = find('[data-name]')
    this.viewEl = find('[data-view]')
    this.formEl = find<HTMLFormElement>('[data-form]')
    this.inputEl = find<HTMLInputElement>('[data-input]')
    this.errorEl = find('[data-error]')
    this.worldTabEl = find('[data-scope="world"]')
    this.countryTabEl = find('[data-scope="country"]')
    this.listEl = find('[data-list]')
    this.statusEl = find('[data-status]')

    this.worldTabEl.addEventListener('click', () => this.setScope('world'))
    this.countryTabEl.addEventListener('click', () => this.setScope('country'))
    find('[data-rename]').addEventListener('click', () => this.editName(true))
    find('[data-cancel]').addEventListener('click', () => this.editName(false))
    this.formEl.addEventListener('submit', (event) => {
      event.preventDefault()
      void this.saveName()
    })
    find('[data-close]').addEventListener('click', onClose)
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) onClose()
    })
    cloud.subscribe(() => this.showProfile())
  }

  get open(): boolean {
    return !this.root.hidden
  }

  /** Whether the name box has the keyboard, so the game should leave keys alone. */
  get typing(): boolean {
    return this.open && !this.formEl.hidden
  }

  show(): void {
    this.root.hidden = false
    this.editName(false)
    this.showProfile()
    void this.load()
  }

  hide(): void {
    this.root.hidden = true
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  /** Reload the open list, for after a new best score. */
  refresh(): void {
    if (this.open) void this.load()
  }

  private showProfile(): void {
    const profile = cloud.profile
    this.nameEl.textContent = profile ? `${flag(profile.country)} ${profile.name}` : '…'
    this.countryTabEl.hidden = !profile?.country
    if (profile?.country) this.countryTabEl.textContent = `${flag(profile.country)} ${countryName(profile.country).toUpperCase()}`
  }

  private setScope(scope: Scope): void {
    this.scope = scope
    this.worldTabEl.classList.toggle('on', scope === 'world')
    this.countryTabEl.classList.toggle('on', scope === 'country')
    void this.load()
  }

  private async load(): Promise<void> {
    const request = ++this.request
    this.statusEl.textContent = 'LOADING…'
    this.listEl.replaceChildren()
    const profile = await cloud.start()
    const rows = profile
      ? await cloud.leaderboard(this.scope === 'country' ? profile.country : null)
      : null
    if (request !== this.request) return
    if (!rows) {
      this.statusEl.textContent = 'The leaderboard needs a connection.'
      return
    }
    this.statusEl.textContent = rows.length === 0 ? 'No scores yet. Fly a run to be first!' : ''
    this.listEl.replaceChildren(...rows.map((row, i) => this.rowElement(row, i > 0 && row.rank > rows[i - 1]!.rank + 1)))
  }

  private rowElement(row: LeaderRow, gap: boolean): HTMLElement {
    const item = document.createElement('li')
    item.className = `board-row${row.isMe ? ' me' : ''}${gap ? ' gap' : ''}`
    const cells: [string, string][] = [
      ['board-rank', `#${row.rank}`],
      ['board-flag', flag(row.country)],
      ['board-name', row.name],
      ['board-score', formatScore(row.score)],
    ]
    for (const [className, text] of cells) {
      const cell = document.createElement('span')
      cell.className = className
      // textContent, never innerHTML: names come from other players.
      cell.textContent = text
      item.appendChild(cell)
    }
    return item
  }

  private editName(editing: boolean): void {
    this.viewEl.hidden = editing
    this.formEl.hidden = !editing
    this.errorEl.textContent = ''
    if (editing) {
      this.inputEl.value = cloud.profile?.name ?? ''
      this.inputEl.focus()
      this.inputEl.select()
    }
  }

  private async saveName(): Promise<void> {
    const name = this.inputEl.value.trim()
    if (name === cloud.profile?.name) {
      this.editName(false)
      return
    }
    const result = await cloud.rename(name)
    if (!result.ok) {
      this.errorEl.textContent = RENAME_ERRORS[result.reason]
      return
    }
    this.editName(false)
    void this.load()
  }
}
