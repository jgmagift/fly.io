import type { Quality } from './settings'

interface SettingsHandlers {
  onToggleMusic: () => void
  onToggleSfx: () => void
  onCycleCamera: () => void
  onToggleQuality: () => void
  onClose: () => void
}

export interface SettingsView {
  music: boolean
  sfx: boolean
  camera: string
  quality: Quality
}

/** The settings sheet, opened from the gear on the menu or from the pause screen. */
export class SettingsPanel {
  private readonly root: HTMLElement
  private readonly values: Record<'music' | 'sfx' | 'camera' | 'quality', HTMLElement>

  constructor(parent: HTMLElement, handlers: SettingsHandlers) {
    this.root = document.createElement('div')
    this.root.className = 'settings'
    this.root.hidden = true
    this.root.innerHTML = `
      <div class="settings-sheet" role="dialog" aria-label="Settings">
        <div class="settings-title">SETTINGS</div>
        <button class="settings-row" data-row="music"><span>MUSIC</span><span class="settings-value" data-value="music"></span></button>
        <button class="settings-row" data-row="sfx"><span>SOUND EFFECTS</span><span class="settings-value" data-value="sfx"></span></button>
        <button class="settings-row" data-row="camera"><span>CAMERA</span><span class="settings-value" data-value="camera"></span></button>
        <button class="settings-row" data-row="quality"><span>GRAPHICS</span><span class="settings-value" data-value="quality"></span></button>
        <div class="settings-help">
          <div class="settings-help-title">HOW TO PLAY</div>
          <div>Steer with &larr; &rarr; or A D, or hold either half of the screen. Fly through gems to collect them.</div>
          <div>Menu: &larr; &rarr; change, &uarr; &darr; switch tab, space to fly.</div>
          <div>In flight: P pause &middot; C camera &middot; M mute</div>
        </div>
        <button class="settings-close" data-close>DONE</button>
      </div>
    `
    parent.appendChild(this.root)
    const find = (selector: string) => this.root.querySelector<HTMLElement>(selector)!
    this.values = {
      music: find('[data-value="music"]'),
      sfx: find('[data-value="sfx"]'),
      camera: find('[data-value="camera"]'),
      quality: find('[data-value="quality"]'),
    }
    find('[data-row="music"]').addEventListener('click', handlers.onToggleMusic)
    find('[data-row="sfx"]').addEventListener('click', handlers.onToggleSfx)
    find('[data-row="camera"]').addEventListener('click', handlers.onCycleCamera)
    find('[data-row="quality"]').addEventListener('click', handlers.onToggleQuality)
    find('[data-close]').addEventListener('click', handlers.onClose)
    // A click on the dimmed backdrop closes the sheet too.
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) handlers.onClose()
    })
  }

  get open(): boolean {
    return !this.root.hidden
  }

  show(): void {
    this.root.hidden = false
  }

  hide(): void {
    this.root.hidden = true
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  update(view: SettingsView): void {
    this.values.music.textContent = view.music ? 'ON' : 'OFF'
    this.values.sfx.textContent = view.sfx ? 'ON' : 'OFF'
    this.values.camera.textContent = view.camera
    this.values.quality.textContent = view.quality === 'high' ? 'HIGH' : 'LOW'
  }
}
