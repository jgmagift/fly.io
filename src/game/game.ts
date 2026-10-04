import { Fog, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three'
import { ads, startingLives } from './ads'
import { GameAudio } from './audio'
import { FollowCamera } from './camera'
import { CAMERA, CAMERA_VIEWS, GAME, SHIP } from './constants'
import { Hud } from './hud'
import type { RunSummary } from './hud'
import { Input } from './input'
import { GameLoop } from './loop'
import { approach } from './math'
import { Menu } from './menu'
import type { Offer } from './menu'
import { PLANES, loadPlaneIndex, savePlaneIndex } from './planes'
import { loadBest, saveBest } from './score'
import { cloud } from './cloud'
import { LeaderboardPanel } from './leaderboard-panel'
import { loadSettings, saveSettings } from './settings'
import { SettingsPanel } from './settings-panel'
import { Ship } from './ship'
import { Shop } from './shop'
import { SKINS, loadSkinIndex, saveSkinIndex } from './skins'
import { Sky } from './sky'
import { Sun } from './sun'
import { Trails } from './trail'
import { VrHud } from './vrhud'
import { World } from './world'
import { WORLDS, loadWorldIndex, saveWorldIndex } from './worlds'
import type { WorldTheme } from './worlds'

type GameState = 'menu' | 'playing' | 'paused' | 'gameover'

/** Shadow map size in VR, where two eyes at 72 to 120 frames a second leave less headroom. */
const VR_SHADOW_MAP_SIZE = 2048

const _eye = new Vector3()

export class Game {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly input: Input
  private readonly audio = new GameAudio()
  private readonly ship: Ship
  private readonly trails = new Trails()
  private readonly world: World
  private readonly sun: Sun
  private readonly sky: Sky
  private readonly fog: Fog
  private readonly follow: FollowCamera
  private readonly hud: Hud
  private readonly vrHud = new VrHud()
  private readonly menu: Menu
  private readonly settingsPanel: SettingsPanel
  private readonly leaderboardPanel: LeaderboardPanel
  /** The best score the leaderboard already has for this player. Only better runs are sent. */
  private submittedBest = 0
  private readonly settings = loadSettings()
  private readonly loop: GameLoop
  private readonly flatShadowMapSize: number

  private state: GameState = 'menu'
  private readonly shop = new Shop()
  private planeIndex = loadPlaneIndex()
  private skinIndex = loadSkinIndex()
  /** Gems picked up in the current run. They are banked when it ends or pauses. */
  private runGems = 0
  private bankedGems = 0
  /** Set by watching a rewarded ad: the next run starts with every life. */
  private fullLives = false
  private worldIndex = loadWorldIndex()
  private best = loadBest()
  private time = 0
  private speed: number = SHIP.forwardSpeed
  private lives = 0
  private score = 0
  private multiplier = 1
  /** Distance flown since the last crash. Drives the multiplier. */
  private streak = 0
  /** Seconds of crash immunity left. */
  private invulnerable = 0
  private gameOverTime = 0
  /** Seconds left in the resume countdown, or 0 while waiting on the pause screen. */
  private resumeTimer = 0
  private lastRun: RunSummary = { score: 0, best: 0, isNewBest: false, distance: 0, gems: 0 }
  /** Distance the world scrolled this frame. The trails stream back by this much. */
  private scrolled = 0
  /** How far the VR comfort vignette is closed in, 0 to 1. */
  private comfort = 0

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    // 'local' puts the origin at the player's eyes when VR starts, so every view works seated or standing.
    this.renderer.xr.enabled = true
    this.renderer.xr.setReferenceSpaceType('local')
    this.renderer.xr.addEventListener('sessionstart', this.onXRStart)
    this.renderer.xr.addEventListener('sessionend', this.onXREnd)

    this.input = new Input(canvas)
    // A remembered choice that is not owned, which only happens if storage was edited or half lost, falls back to the free one.
    if (!this.shop.ownsPlane(PLANES[this.planeIndex]!)) this.planeIndex = 0
    if (!this.shop.ownsSkin(SKINS[this.skinIndex]!)) this.skinIndex = 0
    this.ship = new Ship(PLANES[this.planeIndex]!)
    this.ship.setSkin(SKINS[this.skinIndex]!)
    // Phones get a smaller shadow map; the fitted frustum keeps it looking fine.
    this.flatShadowMapSize = this.input.isTouchDevice ? 2048 : 4096
    const theme = WORLDS[this.worldIndex]!
    this.world = new World(theme)
    this.sun = new Sun(this.flatShadowMapSize, theme)
    this.sky = new Sky(theme)
    this.fog = new Fog(theme.palette.fog, theme.fogNear, theme.fogFar)
    this.follow = new FollowCamera(window.innerWidth / window.innerHeight)
    this.follow.rig.add(this.vrHud.group)
    this.follow.camera.add(this.vrHud.flashMesh, this.vrHud.comfortMesh)

    this.scene.fog = this.fog
    this.scene.add(
      this.sky.mesh,
      this.world.group,
      this.ship.object,
      this.trails.group,
      this.sun.light,
      this.sun.light.target,
      this.sun.ambient,
      this.follow.rig,
    )

    this.hud = new Hud(hudRoot, this.input.isTouchDevice, {
      onMenu: this.enterMenu,
      onSettings: this.openSettings,
      onPause: this.pause,
      onResume: this.resume,
      onQuit: this.enterMenu,
      onWatchAd: this.watchAd,
    })
    this.settingsPanel = new SettingsPanel(hudRoot, {
      onToggleMusic: () => this.changeSettings({ music: !this.settings.music }),
      onToggleSfx: () => this.changeSettings({ sfx: !this.settings.sfx }),
      onCycleCamera: this.cycleCamera,
      onToggleQuality: () => this.changeSettings({ quality: this.settings.quality === 'high' ? 'low' : 'high' }),
      onClose: this.closeSettings,
    })
    this.applySettings()
    this.leaderboardPanel = new LeaderboardPanel(hudRoot, this.closeLeaderboard)
    this.menu = new Menu(hudRoot, {
      onStepPlane: this.stepPlane,
      onStepSkin: this.stepSkin,
      onStepWorld: this.stepWorld,
      onWatchAd: this.watchAd,
      onSettings: this.openSettings,
      onLeaderboard: this.openLeaderboard,
      onPlay: this.confirmMenu,
      onEnterVR: this.enterVR,
    })
    this.applyWorld(theme)
    this.loop = new GameLoop(this.frame)

    window.addEventListener('resize', this.resize)
    // Pause by itself when the player looks away: another tab, another app, or a click outside the window.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return
      if (!this.renderer.xr.isPresenting) this.pause()
      // The tab may never come back, so send any waiting backup now.
      void cloud.flush()
    })
    window.addEventListener('blur', () => {
      if (!this.renderer.xr.isPresenting) this.pause()
    })
    this.resize()
    this.enterMenu()
    this.detectVR()
    void this.restoreFromCloud()
  }

  start(): void {
    this.renderer.setAnimationLoop(this.loop.tick)
  }

  private readonly frame = (dt: number): void => {
    this.time += dt
    this.scrolled = 0
    const inVR = this.renderer.xr.isPresenting
    this.input.pollXR(inVR ? this.renderer.xr.getSession() : null)
    if (this.settingsPanel.open || this.leaderboardPanel.open) {
      // A sheet takes over the keyboard: Escape closes it and nothing reaches the game underneath.
      if (this.input.consumeKey('Escape')) {
        this.closeSettings()
        this.closeLeaderboard()
      }
      this.input.clearPresses()
    }
    if (this.input.consumeKey('KeyM')) this.toggleSound()
    if (this.input.consumeKey('KeyC', 'XRCamera')) this.cycleCamera()

    if (this.state === 'menu') this.browse(dt, inVR)
    else if (this.state === 'playing') this.play(dt)
    else if (this.state === 'paused') this.whilePaused(dt)
    else this.waitForRestart(dt)

    const flying = this.state === 'playing'
    const speedRatio = (this.speed - SHIP.forwardSpeed) / (SHIP.maxSpeed - SHIP.forwardSpeed)
    this.audio.update(flying, this.state === 'gameover' || this.state === 'paused', Math.max(0, speedRatio), flying ? this.input.steer : 0)

    // Frozen while paused; updating with no scroll would reel the trails in.
    if (this.state !== 'paused') this.trails.update(this.ship, this.scrolled)
    this.sun.update(this.ship.x)
    this.follow.update(dt, this.time, this.ship)
    this.sky.update(this.follow.camera.getWorldPosition(_eye))
    this.hud.update(this.score, this.multiplier, this.speed, this.runGems)
    if (inVR) {
      if (flying) {
        const view = CAMERA_VIEWS[this.follow.view].label
        this.vrHud.updateRun(dt, this.score, this.multiplier, this.speed, this.lives, this.ship.plane.lives, view)
      }
      // The cockpit rides with the plane and already feels steady, so only the views behind it close in.
      const sliding = flying && this.follow.view !== 'cockpit' ? Math.abs(this.ship.vx) / this.ship.plane.maxLateralSpeed : 0
      this.comfort = approach(this.comfort, Math.min(1, sliding), GAME.comfortResponse, dt)
      this.vrHud.setComfort(this.comfort)
      this.vrHud.update(dt)
    }
    this.renderer.render(this.scene, this.follow.camera)
  }

  // ---- menu

  private browse(dt: number, inVR: boolean): void {
    const step = this.input.consumeStep()
    const vertical = this.input.consumeVerticalStep()
    if (inVR) {
      // The headset shows its own menu board: the thumbstick flicks sideways for a plane, up and down for a world.
      if (step !== 0) this.stepPlane(step)
      if (vertical !== 0) this.stepWorld(vertical)
    } else {
      if (step !== 0) this.menu.step(step)
      if (vertical !== 0) this.menu.cycleTab(vertical)
    }
    if (this.input.consumeKey('Space', 'Enter', 'XRConfirm')) {
      this.confirmMenu()
      if (this.state !== 'menu') return
    }
    // In VR the player stands still, so the plane turns to show itself off instead of the camera circling it.
    this.ship.showcase(this.time, inVR ? CAMERA.showcaseSwing : 0)
    const speed = inVR ? GAME.vrMenuSpeed : GAME.menuSpeed
    this.world.update(dt, speed)
    this.scrolled = speed * dt
  }

  private readonly enterMenu = (): void => {
    this.commitBest()
    this.bankGems()
    this.state = 'menu'
    this.world.enterMenu()
    this.ship.reset()
    this.trails.reset(this.ship)
    this.follow.mode = 'showcase'
    this.hud.hideGameOver()
    this.hud.hidePause()
    this.hud.setPauseButton(false)
    this.hud.setRunVisible(false, this.input.touched)
    this.menu.setBest(this.best)
    this.refreshMenu()
    this.menu.show()
    this.input.clearPresses()
  }

  /** Redraw everything on the menu that depends on the plane, skin, gems or lives. */
  private refreshMenu(): void {
    const plane = this.ship.plane
    this.menu.setPlane(plane, this.planeIndex, PLANES.length, this.shop.ownsPlane(plane))
    this.menu.setSkin(this.ship.skin, this.skinIndex, SKINS.length, this.shop.ownsSkin(this.ship.skin))
    this.menu.setGems(this.shop.gems)
    this.menu.setOffer(this.offer())
    this.menu.setLives(startingLives(plane.lives, this.fullLives), plane.lives, ads.enabled, this.fullLives)
    this.showVrMenu()
  }

  /** What the main menu button does for the plane and skin on show. A locked plane comes before a locked skin. */
  private offer(): Offer {
    const plane = this.ship.plane
    const skin = this.ship.skin
    const gems = this.shop.gems
    if (!this.shop.ownsPlane(plane)) {
      return { kind: 'plane', price: plane.price, affordable: gems >= plane.price, short: Math.max(0, plane.price - gems) }
    }
    if (!this.shop.ownsSkin(skin)) {
      return { kind: 'skin', price: skin.price, affordable: gems >= skin.price, short: Math.max(0, skin.price - gems) }
    }
    return { kind: 'play', price: 0, affordable: true, short: 0 }
  }

  /** The main menu button: fly, or unlock what is on show if there are gems enough. */
  private readonly confirmMenu = (): void => {
    if (this.state !== 'menu') return
    const offer = this.offer()
    if (offer.kind === 'play') {
      this.startRun()
      return
    }
    const bought = offer.kind === 'plane' ? this.shop.buyPlane(this.ship.plane) : this.shop.buySkin(this.ship.skin)
    if (bought) {
      this.audio.unlocked()
      this.input.pulse(0.6, 80)
      this.rememberChoices()
    } else {
      this.audio.denied()
    }
    this.refreshMenu()
  }

  /** Save the plane and skin on show, but only ones the player owns: a locked preview is never remembered. */
  private rememberChoices(): void {
    if (this.shop.ownsPlane(this.ship.plane)) savePlaneIndex(this.planeIndex)
    if (this.shop.ownsSkin(this.ship.skin)) saveSkinIndex(this.skinIndex)
    this.backUp()
  }

  private readonly stepSkin = (delta: number): void => {
    if (this.state !== 'menu') return
    this.skinIndex = (this.skinIndex + delta + SKINS.length) % SKINS.length
    this.ship.setSkin(SKINS[this.skinIndex]!)
    this.rememberChoices()
    this.refreshMenu()
    this.audio.select()
    this.input.pulse(0.25, 30)
  }

  /** Watch a rewarded ad to start the next run with every life. */
  private readonly watchAd = (): void => {
    if (!ads.enabled || this.fullLives || (this.state !== 'menu' && this.state !== 'gameover')) return
    void ads.show().then((earned) => {
      if (!earned) return
      this.fullLives = true
      this.hud.setAdOffer(true, true)
      if (this.state === 'menu') this.refreshMenu()
    })
  }

  /** Move the gems picked up so far in this run into the wallet. */
  private bankGems(): void {
    const earned = this.runGems - this.bankedGems
    if (earned <= 0) return
    this.shop.addGems(earned)
    this.bankedGems = this.runGems
    this.backUp()
  }

  // ---- cloud

  /** Fold in the progress saved from this player's other sessions, then save the result back. */
  private async restoreFromCloud(): Promise<void> {
    const backup = await cloud.loadProgress()
    if (backup) {
      let changed = this.shop.merge(backup)
      if (backup.best > this.best) {
        this.best = backup.best
        saveBest(this.best)
        changed = true
      }
      if (changed && this.state === 'menu') {
        this.menu.setBest(this.best)
        this.refreshMenu()
      }
    }
    this.backUp()
  }

  /** Save the wallet, unlocks, best and picks to the cloud soon. Cheap to call often. */
  private backUp(): void {
    cloud.saveProgress({
      gems: this.shop.gems,
      planes: this.shop.ownedPlanes(),
      skins: this.shop.ownedSkins(),
      best: this.best,
      plane: PLANES[this.planeIndex]!.id,
      skin: SKINS[this.skinIndex]!.id,
      world: WORLDS[this.worldIndex]!.id,
      updatedAt: this.shop.updatedAt || Date.now(),
    })
  }

  /** Send a finished run to the leaderboard if it beats what is there, and show the rank it earns. */
  private submitRun(run: RunSummary): void {
    if (run.score <= this.submittedBest) return
    void cloud
      .submitScore({ score: run.score, distance: run.distance, world: WORLDS[this.worldIndex]!.id, plane: this.ship.plane.id })
      .then((result) => {
        if (!result) return
        this.submittedBest = result.best
        if (this.state === 'gameover' && this.lastRun === run) this.hud.showRank(result.rank)
      })
  }

  private readonly openLeaderboard = (): void => {
    if (this.state !== 'menu') return
    this.leaderboardPanel.show()
  }

  private readonly closeLeaderboard = (): void => {
    this.leaderboardPanel.hide()
    this.input.clearPresses()
  }

  private readonly stepPlane = (delta: number): void => {
    if (this.state !== 'menu') return
    this.planeIndex = (this.planeIndex + delta + PLANES.length) % PLANES.length
    const plane = PLANES[this.planeIndex]!
    this.ship.setPlane(plane)
    this.trails.reset(this.ship)
    this.rememberChoices()
    this.refreshMenu()
    this.audio.select()
    this.input.pulse(0.25, 30)
  }

  /** Swap the landscape, sky and light for another world, in place, while the menu is up. */
  private readonly stepWorld = (delta: number): void => {
    if (this.state !== 'menu') return
    this.worldIndex = (this.worldIndex + delta + WORLDS.length) % WORLDS.length
    const theme = WORLDS[this.worldIndex]!
    this.world.setTheme(theme)
    this.applyWorld(theme)
    this.showVrMenu()
    saveWorldIndex(this.worldIndex)
    this.backUp()
    this.audio.select()
    this.input.pulse(0.25, 30)
  }

  /** Dress the sky, light, fog, page and menu for a world. The landscape itself is rebuilt by World.setTheme. */
  private applyWorld(theme: WorldTheme): void {
    this.sky.setTheme(theme)
    this.sun.setTheme(theme)
    this.fog.color.setHex(theme.palette.fog)
    this.fog.near = theme.fogNear
    this.fog.far = theme.fogFar
    document.body.style.background = `#${theme.palette.fog.toString(16).padStart(6, '0')}`
    this.menu.setWorld(theme, this.worldIndex, WORLDS.length)
  }

  private showVrMenu(): void {
    this.vrHud.showMenu(
      this.ship.plane,
      this.planeIndex,
      PLANES.length,
      this.best,
      WORLDS[this.worldIndex]!,
      this.shop.gems,
      this.ship.skin.name,
      this.offer(),
    )
  }

  // ---- run

  private readonly startRun = (): void => {
    if (this.state === 'playing') return
    // A locked plane or skin can be looked at, never flown.
    if (this.offer().kind !== 'play') return
    this.state = 'playing'
    this.lives = startingLives(this.ship.plane.lives, this.fullLives)
    this.fullLives = false
    this.runGems = 0
    this.bankedGems = 0
    this.score = 0
    this.streak = 0
    this.multiplier = 1
    this.invulnerable = 0
    this.resumeTimer = 0
    this.speed = SHIP.forwardSpeed
    this.world.beginRun()
    this.ship.reset()
    this.trails.reset(this.ship)
    this.follow.mode = 'run'
    this.menu.hide()
    this.hud.hideGameOver()
    this.hud.hidePause()
    this.hud.setPauseButton(true)
    this.hud.setLives(this.lives, this.ship.plane.lives)
    this.hud.setRunVisible(true, this.input.touched)
    this.vrHud.showRun()
    this.audio.start()
    this.input.clearPresses()
  }

  private play(dt: number): void {
    if (this.input.consumeKey('Escape', 'KeyP', 'XRPause')) {
      this.pause()
      return
    }
    if (this.input.touched) this.hud.hideHint()

    this.speed = Math.min(SHIP.maxSpeed, SHIP.forwardSpeed + this.world.distance * SHIP.speedRamp)
    const travelled = this.speed * dt
    this.scrolled = travelled
    this.ship.update(dt, this.input.steer)
    this.world.update(dt, this.speed)

    this.streak += travelled
    const multiplier = Math.min(GAME.maxMultiplier, 1 + Math.floor(this.streak / GAME.multiplierDistance))
    if (multiplier > this.multiplier) {
      this.audio.multiplierUp()
      this.input.pulse(0.35, 50)
    }
    this.multiplier = multiplier
    this.score += travelled * this.multiplier

    const collected = this.world.collect(this.ship.x, this.ship.plane.halfWidth, GAME.shipHalfDepth, travelled)
    if (collected > 0) {
      this.runGems += collected
      this.audio.collect()
      this.input.pulse(0.2, 20)
    }

    this.invulnerable = Math.max(0, this.invulnerable - dt)
    if (this.invulnerable === 0) {
      const plane = this.ship.plane
      const hit = this.world.collide(this.ship.x, SHIP.hoverHeight, plane.halfWidth, GAME.shipHalfDepth, travelled)
      if (hit) this.crash()
    }
    this.ship.setBlink(this.invulnerable > 0, this.time)
  }

  private crash(): void {
    this.lives -= 1
    this.streak = 0
    this.multiplier = 1
    this.hud.setLives(this.lives, this.ship.plane.lives)
    this.hud.flash()
    this.vrHud.flash()
    this.follow.shake(1)
    this.audio.crash()
    this.input.pulse(1, 160)
    if (this.lives > 0) {
      this.invulnerable = GAME.invulnerableTime
      return
    }

    this.state = 'gameover'
    this.speed = 0
    this.gameOverTime = 0
    this.ship.object.visible = false
    this.hud.setPauseButton(false)
    const isNewBest = this.score > this.best
    this.commitBest()
    this.bankGems()
    this.lastRun = { score: this.score, best: this.best, isNewBest, distance: this.world.distance, gems: this.runGems }
    this.audio.gameOver()
    this.hud.setAdOffer(ads.enabled, false)
    this.hud.showGameOver(this.lastRun)
    this.vrHud.showGameOver(this.lastRun)
    this.input.clearPresses()
    this.submitRun(this.lastRun)
  }

  private waitForRestart(dt: number): void {
    this.gameOverTime += dt
    if (this.input.consumeKey('Escape', 'XRBack')) {
      this.enterMenu()
      return
    }
    // Always consume, so a press during the delay is discarded instead of queued.
    const pressed = this.input.consumeConfirm()
    if (pressed && this.gameOverTime >= GAME.restartDelay) this.startRun()
  }

  // ---- pause

  private readonly pause = (): void => {
    if (this.state !== 'playing') return
    this.state = 'paused'
    this.resumeTimer = 0
    // Never freeze on the invisible half of the post-crash blink.
    this.ship.object.visible = true
    // Banked here too, so closing the tab from the pause screen keeps what was picked up.
    this.bankGems()
    this.hud.showPause()
    this.hud.setPauseButton(false)
    this.vrHud.showPause()
    this.input.clearPresses()
  }

  /** Start the 3, 2, 1 countdown back into the run. */
  private readonly resume = (): void => {
    if (this.state !== 'paused' || this.resumeTimer > 0) return
    this.resumeTimer = GAME.resumeSteps * GAME.resumeStepSeconds
    this.input.clearPresses()
  }

  private whilePaused(dt: number): void {
    if (this.resumeTimer > 0) {
      // Pausing again during the countdown goes back to the pause screen.
      if (this.input.consumeKey('Escape', 'KeyP', 'XRPause')) {
        this.state = 'playing'
        this.pause()
        return
      }
      this.resumeTimer -= dt
      if (this.resumeTimer <= 0) {
        this.resumeTimer = 0
        this.state = 'playing'
        this.hud.hidePause()
        this.hud.setPauseButton(true)
        this.vrHud.showRun()
        this.input.clearPresses()
        return
      }
      const step = Math.ceil(this.resumeTimer / GAME.resumeStepSeconds)
      this.hud.showCountdown(step)
      this.vrHud.showCountdown(step)
      return
    }
    if (this.input.consumeKey('KeyQ', 'XRBack')) {
      this.enterMenu()
      return
    }
    if (this.input.consumeKey('Escape', 'KeyP') || this.input.consumeConfirm()) this.resume()
  }

  private commitBest(): void {
    if (this.score <= this.best) return
    this.best = Math.floor(this.score)
    saveBest(this.best)
  }

  /** M mutes everything, or brings both music and effects back. */
  private readonly toggleSound = (): void => {
    const on = !(this.settings.music || this.settings.sfx)
    this.changeSettings({ music: on, sfx: on })
  }

  private changeSettings(change: Partial<typeof this.settings>): void {
    Object.assign(this.settings, change)
    saveSettings(this.settings)
    this.applySettings()
  }

  /** Put the settings into effect and show them on the sheet. */
  private applySettings(): void {
    const { music, sfx, quality } = this.settings
    this.audio.setMix(music, sfx)
    // Low quality drops the shadows and renders one pixel per point instead of up to two.
    this.sun.light.castShadow = quality === 'high'
    this.renderer.setPixelRatio(quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1)
    this.resize()
    this.settingsPanel.update({ music, sfx, quality, camera: CAMERA_VIEWS[this.follow.view].label })
  }

  private readonly openSettings = (): void => {
    if (this.state !== 'menu' && this.state !== 'paused') return
    this.settingsPanel.show()
  }

  private readonly closeSettings = (): void => {
    this.settingsPanel.hide()
    this.input.clearPresses()
  }

  private readonly cycleCamera = (): void => {
    this.follow.cycleView()
    this.applySettings()
    this.audio.select()
  }

  // ---- VR

  /** Offer VR only when the browser reports a headset. WebXR only exists on secure (https) pages. */
  private detectVR(): void {
    const xr = navigator.xr
    if (!xr) {
      if (/OculusBrowser/i.test(navigator.userAgent) && !window.isSecureContext) this.menu.setVrStatus('needs-https')
      return
    }
    xr.isSessionSupported('immersive-vr')
      .then((supported) => {
        if (supported) this.menu.setVrStatus('available')
      })
      .catch(() => undefined)
  }

  private readonly enterVR = (): void => {
    const xr = navigator.xr
    if (!xr || this.renderer.xr.isPresenting) return
    // Requested straight from the click, before anything asynchronous, or the browser refuses.
    xr.requestSession('immersive-vr', { optionalFeatures: ['layers'] })
      .then((session) => this.renderer.xr.setSession(session))
      .catch((error: unknown) => {
        console.warn('VR session failed to start', error)
        this.menu.setVrStatus('failed')
      })
  }

  private readonly onXRStart = (): void => {
    // The Quest home button or taking the headset off hides the session: pause the run.
    this.renderer.xr.getSession()?.addEventListener('visibilitychange', this.onXRVisibility)
    this.follow.setXR(true)
    this.sun.setShadowMapSize(VR_SHADOW_MAP_SIZE)
    this.vrHud.setVisible(true)
    if (this.state === 'menu') this.showVrMenu()
    else if (this.state === 'playing') this.vrHud.showRun()
    else if (this.state === 'paused') this.vrHud.showPause()
    else this.vrHud.showGameOver(this.lastRun)
    this.input.clearPresses()
  }

  private readonly onXRVisibility = (): void => {
    const session = this.renderer.xr.getSession()
    if (session && session.visibilityState !== 'visible') this.pause()
  }

  private readonly onXREnd = (): void => {
    // Leaving VR mid-run pauses it rather than letting the plane fly on unattended.
    this.pause()
    this.follow.setXR(false)
    this.sun.setShadowMapSize(this.flatShadowMapSize)
    this.vrHud.setVisible(false)
    this.input.clearPresses()
    this.resize()
  }

  private readonly resize = (): void => {
    // The headset owns the resolution while VR is running.
    if (this.renderer.xr.isPresenting) return
    const width = window.innerWidth
    const height = window.innerHeight
    this.renderer.setSize(width, height)
    this.follow.resize(width / height)
  }
}
