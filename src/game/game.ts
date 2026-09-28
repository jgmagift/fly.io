import { Fog, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three'
import { GameAudio } from './audio'
import { FollowCamera } from './camera'
import { CAMERA, CAMERA_VIEWS, GAME, PALETTE, SHIP, SKY } from './constants'
import { Hud } from './hud'
import type { RunSummary } from './hud'
import { Input } from './input'
import { GameLoop } from './loop'
import { Menu } from './menu'
import { PLANES, loadPlaneIndex, savePlaneIndex } from './planes'
import { loadBest, saveBest } from './score'
import { Ship } from './ship'
import { Sky } from './sky'
import { Sun } from './sun'
import { Trails } from './trail'
import { VrHud } from './vrhud'
import { World } from './world'

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
  private readonly world = new World()
  private readonly sun: Sun
  private readonly sky: Sky
  private readonly follow: FollowCamera
  private readonly hud: Hud
  private readonly vrHud = new VrHud()
  private readonly menu: Menu
  private readonly loop: GameLoop
  private readonly flatShadowMapSize: number

  private state: GameState = 'menu'
  private planeIndex = loadPlaneIndex()
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
  private lastRun: RunSummary = { score: 0, best: 0, isNewBest: false, distance: 0 }
  /** Distance the world scrolled this frame. The trails stream back by this much. */
  private scrolled = 0

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    // 'local' puts the origin at the player's eyes when VR starts, so every view works seated or standing.
    this.renderer.xr.enabled = true
    this.renderer.xr.setReferenceSpaceType('local')
    this.renderer.xr.addEventListener('sessionstart', this.onXRStart)
    this.renderer.xr.addEventListener('sessionend', this.onXREnd)

    this.input = new Input(canvas)
    this.ship = new Ship(PLANES[this.planeIndex]!)
    // Phones get a smaller shadow map; the fitted frustum keeps it looking fine.
    this.flatShadowMapSize = this.input.isTouchDevice ? 2048 : 4096
    this.sun = new Sun(this.flatShadowMapSize)
    this.sky = new Sky(this.sun.direction)
    this.follow = new FollowCamera(window.innerWidth / window.innerHeight)
    this.follow.rig.add(this.vrHud.group)
    this.follow.camera.add(this.vrHud.flashMesh)

    this.scene.fog = new Fog(PALETTE.fog, SKY.fogNear, SKY.fogFar)
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
      onToggleSound: this.toggleSound,
      onCycleCamera: this.cycleCamera,
      onPause: this.pause,
      onResume: this.resume,
      onQuit: this.enterMenu,
    })
    this.hud.setSound(this.audio.muted)
    this.hud.setCamera(CAMERA_VIEWS[this.follow.view].label)
    this.menu = new Menu(hudRoot, { onStep: this.stepPlane, onPlay: this.startRun, onEnterVR: this.enterVR })
    this.loop = new GameLoop(this.frame)

    window.addEventListener('resize', this.resize)
    // Pause by itself when the player looks away: another tab, another app, or a click outside the window.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.renderer.xr.isPresenting) this.pause()
    })
    window.addEventListener('blur', () => {
      if (!this.renderer.xr.isPresenting) this.pause()
    })
    this.resize()
    this.enterMenu()
    this.detectVR()
  }

  start(): void {
    this.renderer.setAnimationLoop(this.loop.tick)
  }

  private readonly frame = (dt: number): void => {
    this.time += dt
    this.scrolled = 0
    const inVR = this.renderer.xr.isPresenting
    this.input.pollXR(inVR ? this.renderer.xr.getSession() : null)
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
    this.hud.update(this.score, this.multiplier, this.speed)
    if (inVR) {
      if (flying) {
        const view = CAMERA_VIEWS[this.follow.view].label
        this.vrHud.updateRun(dt, this.score, this.multiplier, this.speed, this.lives, this.ship.plane.lives, view)
      }
      this.vrHud.update(dt)
    }
    this.renderer.render(this.scene, this.follow.camera)
  }

  // ---- menu

  private browse(dt: number, inVR: boolean): void {
    const step = this.input.consumeStep()
    if (step !== 0) this.stepPlane(step)
    if (this.input.consumeKey('Space', 'Enter', 'XRConfirm')) {
      this.startRun()
      return
    }
    // In VR the player stands still, so the plane turns to show itself off instead of the camera circling it.
    this.ship.showcase(this.time, inVR ? CAMERA.showcaseSwing : 0)
    const speed = inVR ? GAME.vrMenuSpeed : GAME.menuSpeed
    this.world.update(dt, speed)
    this.scrolled = speed * dt
  }

  private readonly enterMenu = (): void => {
    this.commitBest()
    this.state = 'menu'
    this.world.enterMenu()
    this.ship.reset()
    this.trails.reset(this.ship)
    this.follow.mode = 'showcase'
    this.hud.hideGameOver()
    this.hud.hidePause()
    this.hud.setPauseButton(false)
    this.hud.setRunVisible(false, this.input.touched)
    this.menu.setPlane(this.ship.plane, this.planeIndex, PLANES.length)
    this.menu.setBest(this.best)
    this.menu.show()
    this.vrHud.showMenu(this.ship.plane, this.planeIndex, PLANES.length, this.best)
    this.input.clearPresses()
  }

  private readonly stepPlane = (delta: number): void => {
    if (this.state !== 'menu') return
    this.planeIndex = (this.planeIndex + delta + PLANES.length) % PLANES.length
    const plane = PLANES[this.planeIndex]!
    this.ship.setPlane(plane)
    this.trails.reset(this.ship)
    this.menu.setPlane(plane, this.planeIndex, PLANES.length)
    this.vrHud.showMenu(plane, this.planeIndex, PLANES.length, this.best)
    savePlaneIndex(this.planeIndex)
    this.audio.select()
    this.input.pulse(0.25, 30)
  }

  // ---- run

  private readonly startRun = (): void => {
    if (this.state === 'playing') return
    this.state = 'playing'
    this.lives = this.ship.plane.lives
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
    this.lastRun = { score: this.score, best: this.best, isNewBest, distance: this.world.distance }
    this.audio.gameOver()
    this.hud.showGameOver(this.lastRun)
    this.vrHud.showGameOver(this.lastRun)
    this.input.clearPresses()
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

  private readonly toggleSound = (): void => {
    this.hud.setSound(this.audio.toggleMute())
  }

  private readonly cycleCamera = (): void => {
    const view = this.follow.cycleView()
    this.hud.setCamera(CAMERA_VIEWS[view].label)
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
    if (this.state === 'menu') this.vrHud.showMenu(this.ship.plane, this.planeIndex, PLANES.length, this.best)
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
