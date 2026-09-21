import { Fog, PCFShadowMap, Scene, WebGLRenderer } from 'three'
import { GameAudio } from './audio'
import { FollowCamera } from './camera'
import { GAME, PALETTE, SHIP, SKY } from './constants'
import { Hud } from './hud'
import { Input } from './input'
import { GameLoop } from './loop'
import { Menu } from './menu'
import { PLANES, loadPlaneIndex, savePlaneIndex } from './planes'
import { loadBest, saveBest } from './score'
import { Ship } from './ship'
import { Sky } from './sky'
import { Sun } from './sun'
import { Trails } from './trail'
import { World } from './world'

type GameState = 'menu' | 'playing' | 'gameover'

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
  private readonly menu: Menu
  private readonly loop: GameLoop

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
  /** Distance the world scrolled this frame. The trails stream back by this much. */
  private scrolled = 0

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap

    this.input = new Input(canvas)
    this.ship = new Ship(PLANES[this.planeIndex]!)
    // Phones get a smaller shadow map; the fitted frustum keeps it looking fine.
    this.sun = new Sun(this.input.isTouchDevice ? 2048 : 4096)
    this.sky = new Sky(this.sun.direction)

    this.scene.fog = new Fog(PALETTE.fog, SKY.fogNear, SKY.fogFar)
    this.scene.add(
      this.sky.mesh,
      this.world.group,
      this.ship.object,
      this.trails.group,
      this.sun.light,
      this.sun.light.target,
      this.sun.ambient,
    )

    this.hud = new Hud(hudRoot, this.input.isTouchDevice, {
      onMenu: this.enterMenu,
      onToggleSound: this.toggleSound,
    })
    this.hud.setSound(this.audio.muted)
    this.menu = new Menu(hudRoot, { onStep: this.stepPlane, onPlay: this.startRun })
    this.follow = new FollowCamera(window.innerWidth / window.innerHeight)
    this.loop = new GameLoop(this.frame)

    window.addEventListener('resize', this.resize)
    this.resize()
    this.enterMenu()
  }

  start(): void {
    this.renderer.setAnimationLoop(this.loop.tick)
  }

  private readonly frame = (dt: number): void => {
    this.time += dt
    this.scrolled = 0
    if (this.input.consumeKey('KeyM')) this.toggleSound()

    if (this.state === 'menu') this.browse(dt)
    else if (this.state === 'playing') this.play(dt)
    else this.waitForRestart(dt)

    const flying = this.state === 'playing'
    const speedRatio = (this.speed - SHIP.forwardSpeed) / (SHIP.maxSpeed - SHIP.forwardSpeed)
    this.audio.update(flying, this.state === 'gameover', Math.max(0, speedRatio), flying ? this.input.steer : 0)

    this.trails.update(this.ship, this.scrolled)
    this.sun.update(this.ship.x)
    this.follow.update(dt, this.time, this.ship)
    this.sky.update(this.follow.camera.position)
    this.hud.update(this.score, this.multiplier, this.speed)
    this.renderer.render(this.scene, this.follow.camera)
  }

  // ---- menu

  private browse(dt: number): void {
    const step = this.input.consumeStep()
    if (step !== 0) this.stepPlane(step)
    if (this.input.consumeKey('Space', 'Enter')) {
      this.startRun()
      return
    }
    this.ship.showcase(this.time)
    this.world.update(dt, GAME.menuSpeed)
    this.scrolled = GAME.menuSpeed * dt
  }

  private readonly enterMenu = (): void => {
    this.commitBest()
    this.state = 'menu'
    this.world.enterMenu()
    this.ship.reset()
    this.trails.reset(this.ship)
    this.follow.mode = 'showcase'
    this.hud.hideGameOver()
    this.hud.setRunVisible(false, this.input.touched)
    this.menu.setPlane(this.ship.plane, this.planeIndex, PLANES.length)
    this.menu.setBest(this.best)
    this.menu.show()
    this.input.clearPresses()
  }

  private readonly stepPlane = (delta: number): void => {
    if (this.state !== 'menu') return
    this.planeIndex = (this.planeIndex + delta + PLANES.length) % PLANES.length
    const plane = PLANES[this.planeIndex]!
    this.ship.setPlane(plane)
    this.trails.reset(this.ship)
    this.menu.setPlane(plane, this.planeIndex, PLANES.length)
    savePlaneIndex(this.planeIndex)
    this.audio.select()
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
    this.speed = SHIP.forwardSpeed
    this.world.beginRun()
    this.ship.reset()
    this.trails.reset(this.ship)
    this.follow.mode = 'chase'
    this.menu.hide()
    this.hud.hideGameOver()
    this.hud.setLives(this.lives, this.ship.plane.lives)
    this.hud.setRunVisible(true, this.input.touched)
    this.audio.start()
    this.input.clearPresses()
  }

  private play(dt: number): void {
    if (this.input.consumeKey('Escape')) {
      this.enterMenu()
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
    if (multiplier > this.multiplier) this.audio.multiplierUp()
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
    this.follow.shake(1)
    this.audio.crash()
    if (this.lives > 0) {
      this.invulnerable = GAME.invulnerableTime
      return
    }

    this.state = 'gameover'
    this.speed = 0
    this.gameOverTime = 0
    this.ship.object.visible = false
    const isNewBest = this.score > this.best
    this.commitBest()
    this.audio.gameOver()
    this.hud.showGameOver({ score: this.score, best: this.best, isNewBest, distance: this.world.distance })
    this.input.clearPresses()
  }

  private waitForRestart(dt: number): void {
    this.gameOverTime += dt
    if (this.input.consumeKey('Escape')) {
      this.enterMenu()
      return
    }
    // Always consume, so a press during the delay is discarded instead of queued.
    const pressed = this.input.consumeConfirm()
    if (pressed && this.gameOverTime >= GAME.restartDelay) this.startRun()
  }

  private commitBest(): void {
    if (this.score <= this.best) return
    this.best = Math.floor(this.score)
    saveBest(this.best)
  }

  private readonly toggleSound = (): void => {
    this.hud.setSound(this.audio.toggleMute())
  }

  private readonly resize = (): void => {
    const width = window.innerWidth
    const height = window.innerHeight
    this.renderer.setSize(width, height)
    this.follow.resize(width / height)
  }
}
