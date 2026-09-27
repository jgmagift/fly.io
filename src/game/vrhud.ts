import {
  BackSide,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  SphereGeometry,
} from 'three'
import type { RunSummary } from './hud'
import type { PlaneSpec } from './planes'
import { formatScore } from './score'

const FONT = 'ui-monospace, "SF Mono", Menlo, "Roboto Mono", "Droid Sans Mono", monospace'
const CREAM = '#fff4d6'
const FADED = 'rgba(255, 244, 214, 0.62)'
const DIM = 'rgba(255, 244, 214, 0.2)'
const GOLD = '#ffc857'
const ACCENT = '#e0572f'
const BACKDROP = 'rgba(32, 22, 40, 0.8)'
/** Seconds between redraws of the in-run readout. The score changes every frame; the texture upload need not. */
const RUN_REDRAW_INTERVAL = 0.1

const STAT_LABELS = [
  ['agility', 'AGILITY'],
  ['armor', 'ARMOR'],
  ['slim', 'SLIM'],
] as const

interface TextOptions {
  color?: string
  align?: CanvasTextAlign
  spacing?: number
  bold?: boolean
}

/** A flat panel in the world whose face is a 2D canvas. */
class CanvasPanel {
  readonly mesh: Mesh
  readonly ctx: CanvasRenderingContext2D
  readonly width: number
  readonly height: number
  private readonly texture: CanvasTexture

  constructor(width: number, height: number, metresWide: number) {
    this.width = width
    this.height = height
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    this.ctx = canvas.getContext('2d')!
    this.texture = new CanvasTexture(canvas)
    this.texture.colorSpace = SRGBColorSpace
    this.texture.anisotropy = 4
    const material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    this.mesh = new Mesh(new PlaneGeometry(metresWide, (metresWide * height) / width), material)
    // Drawn last and over everything, so scenery flying past can never hide it.
    this.mesh.renderOrder = 10
  }

  /** Place the panel at rig-local (0, y, z), tilted to face the eyes at the rig origin. */
  place(y: number, z: number): void {
    this.mesh.position.set(0, y, z)
    this.mesh.rotation.set(-Math.atan2(-y, -z), 0, 0)
  }

  /** Clear the canvas and paint the rounded backdrop. */
  begin(): CanvasRenderingContext2D {
    const { ctx, width, height } = this
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = BACKDROP
    ctx.beginPath()
    ctx.roundRect(4, 4, width - 8, height - 8, 28)
    ctx.fill()
    ctx.textBaseline = 'middle'
    return ctx
  }

  commit(): void {
    this.texture.needsUpdate = true
  }
}

/** Draw one line of text and return its width in pixels. */
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, options: TextOptions = {}): number {
  const { color = CREAM, align = 'center', spacing = 0, bold = false } = options
  ctx.font = `${bold ? '700 ' : ''}${size}px ${FONT}`
  ctx.letterSpacing = `${spacing}px`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText(value, x, y)
  return ctx.measureText(value).width
}

/**
 * The HUD, menu and game-over screens for VR, where the page's HTML overlay cannot be seen.
 * Panels hang below the line of sight, fixed to the camera rig rather than to the head, which is
 * easier on the eyes. A red sphere around the head stands in for the screen flash on impact.
 */
export class VrHud {
  readonly group = new Group()
  /** Parent this to the camera, so the flash surrounds the player's head. */
  readonly flashMesh: Mesh<SphereGeometry, MeshBasicMaterial>
  private readonly board = new CanvasPanel(1024, 640, 1.3)
  private readonly strip = new CanvasPanel(1024, 176, 1.1)
  private flashLevel = 0
  private runKey = ''
  private sinceRunDraw = 0

  constructor() {
    // Low enough to clear the hovering plane in the menu, and the plane itself in every flight view.
    this.board.place(-0.95, -1.6)
    this.strip.place(-0.95, -1.4)
    this.group.add(this.board.mesh, this.strip.mesh)
    this.group.visible = false

    this.flashMesh = new Mesh(
      new SphereGeometry(0.4, 16, 8),
      new MeshBasicMaterial({
        color: 0xd8342a,
        transparent: true,
        opacity: 0,
        side: BackSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    )
    this.flashMesh.renderOrder = 11
    this.flashMesh.visible = false
  }

  get visible(): boolean {
    return this.group.visible
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible
    this.flashLevel = 0
    this.flashMesh.visible = false
  }

  showMenu(plane: PlaneSpec, index: number, count: number, best: number): void {
    if (!this.visible) return
    this.board.mesh.visible = true
    this.strip.mesh.visible = false
    const ctx = this.board.begin()
    const { width } = this.board
    const mid = width / 2
    text(ctx, 'FLY.IO', mid, 64, 60, { spacing: 16, bold: true })
    if (best > 0) text(ctx, `BEST ${formatScore(best)}`, mid, 112, 24, { color: GOLD, spacing: 4 })
    text(ctx, '◀', 80, 300, 56, { color: FADED })
    text(ctx, '▶', width - 80, 300, 56, { color: FADED })
    text(ctx, plane.name, mid, 190, 56, { spacing: 14, bold: true })
    text(ctx, `${plane.tagline} · ${plane.lives} lives`, mid, 242, 24, { color: FADED })
    STAT_LABELS.forEach(([key, label], row) => {
      const y = 300 + row * 42
      text(ctx, label, 300, y, 22, { color: FADED, align: 'left', spacing: 4 })
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i < plane.stats[key] ? CREAM : DIM
        ctx.fillRect(530 + i * 40, y - 6, 32, 12)
      }
    })
    const dotGap = 22
    const firstDot = mid - ((count - 1) * dotGap) / 2
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = i === index ? CREAM : 'rgba(255, 244, 214, 0.3)'
      ctx.beginPath()
      ctx.arc(firstDot + i * dotGap, 440, 6, 0, Math.PI * 2)
      ctx.fill()
    }
    text(ctx, 'THUMBSTICK ◀ ▶ CHOOSE    TRIGGER  FLY', mid, 530, 24, { spacing: 2 })
    text(ctx, 'B / Y  CHANGES THE CAMERA VIEW', mid, 580, 20, { color: FADED, spacing: 2 })
    this.board.commit()
  }

  showRun(): void {
    if (!this.visible) return
    this.board.mesh.visible = false
    this.strip.mesh.visible = true
    this.runKey = ''
  }

  updateRun(
    dt: number,
    score: number,
    multiplier: number,
    speed: number,
    lives: number,
    maxLives: number,
    view: string,
  ): void {
    if (!this.visible) return
    this.sinceRunDraw += dt
    const key = `${multiplier}|${lives}|${maxLives}|${view}`
    if (key === this.runKey && this.sinceRunDraw < RUN_REDRAW_INTERVAL) return
    this.runKey = key
    this.sinceRunDraw = 0

    const ctx = this.strip.begin()
    const { width } = this.strip
    text(ctx, 'SCORE', 44, 42, 20, { color: FADED, align: 'left', spacing: 4 })
    const scoreWidth = text(ctx, formatScore(score), 44, 94, 46, { align: 'left', bold: true })
    const badgeX = 44 + scoreWidth + 18
    ctx.fillStyle = multiplier > 1 ? ACCENT : DIM
    ctx.beginPath()
    ctx.roundRect(badgeX, 74, 68, 40, 6)
    ctx.fill()
    text(ctx, `x${multiplier}`, badgeX + 34, 95, 24, { bold: true })

    const livesCentre = width / 2 + 70
    const gap = Math.min(22, 340 / Math.max(1, maxLives - 1))
    const firstLife = livesCentre - ((maxLives - 1) * gap) / 2
    text(ctx, 'LIVES', livesCentre, 42, 20, { color: FADED, spacing: 4 })
    for (let i = 0; i < maxLives; i++) {
      ctx.save()
      ctx.translate(firstLife + i * gap, 94)
      ctx.rotate(Math.PI / 4)
      ctx.fillStyle = i < lives ? CREAM : DIM
      ctx.fillRect(-5, -5, 10, 10)
      ctx.restore()
    }

    text(ctx, 'SPEED', width - 44, 42, 20, { color: FADED, align: 'right', spacing: 4 })
    text(ctx, String(Math.round(speed)), width - 44, 94, 46, { align: 'right', bold: true })
    text(ctx, `B / Y  CAMERA · ${view}`, width / 2, 148, 18, { color: FADED, spacing: 3 })
    this.strip.commit()
  }

  showGameOver(run: RunSummary): void {
    if (!this.visible) return
    this.board.mesh.visible = true
    this.strip.mesh.visible = false
    const ctx = this.board.begin()
    const mid = this.board.width / 2
    const flown = `${Math.floor(run.distance)} m flown`
    text(ctx, 'GAME OVER', mid, 130, 72, { spacing: 18, bold: true })
    text(ctx, formatScore(run.score), mid, 250, 72, { bold: true })
    text(ctx, run.isNewBest ? `NEW BEST · ${flown}` : `best ${formatScore(run.best)} · ${flown}`, mid, 330, 26, {
      color: run.isNewBest ? GOLD : FADED,
      spacing: 3,
    })
    text(ctx, 'TRIGGER  FLY AGAIN', mid, 470, 30, { spacing: 4 })
    text(ctx, 'GRIP  CHANGE PLANE', mid, 530, 30, { color: FADED, spacing: 4 })
    this.board.commit()
  }

  flash(): void {
    this.flashLevel = 0.3
  }

  /** Fade the impact flash. Call every frame while in VR. */
  update(dt: number): void {
    if (this.flashLevel <= 0) return
    this.flashLevel = Math.max(0, this.flashLevel - dt * 0.75)
    this.flashMesh.material.opacity = this.flashLevel
    this.flashMesh.visible = this.flashLevel > 0
  }
}
