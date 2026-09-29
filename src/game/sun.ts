import { DirectionalLight, HemisphereLight, Vector3 } from 'three'
import { WORLD } from './constants'
import type { WorldTheme } from './worlds'

/** How much of the world around the ship receives shadows: x left/right, y up, z ahead (negative) and behind. */
const SHADOW_REGION = {
  halfWidth: WORLD.playHalfWidth + 50,
  height: 45,
  ahead: -330,
  behind: 60,
} as const

const _corner = new Vector3()
const _forward = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const WORLD_UP = new Vector3(0, 1, 0)

/** The sun and the sky's ambient light. Each world places and colours them; dusk sits low for long shadows. */
export class Sun {
  readonly light = new DirectionalLight()
  readonly ambient = new HemisphereLight()
  /** Unit vector pointing from the ship toward the sun. */
  readonly direction = new Vector3()
  /** Light placement distance from the ship. Larger than the shadow region so nothing sits behind the light. */
  private readonly distance = 450

  constructor(shadowMapSize: number, theme: WorldTheme) {
    this.light.castShadow = true
    this.light.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    this.light.shadow.bias = -0.0003
    this.light.shadow.normalBias = 0.05
    this.setTheme(theme)
  }

  setTheme(theme: WorldTheme): void {
    const { palette } = theme
    this.light.color.setHex(palette.sunLight)
    this.light.intensity = theme.sunIntensity
    this.ambient.color.setHex(palette.hemiSky)
    this.ambient.groundColor.setHex(palette.hemiGround)
    this.ambient.intensity = theme.ambientIntensity
    this.direction.set(...theme.sunDirection).normalize()
    this.fitShadowFrustum()
  }

  /** Change the shadow resolution at runtime. The old map is freed and rebuilt at the new size on the next render. */
  setShadowMapSize(size: number): void {
    const shadow = this.light.shadow
    if (shadow.mapSize.x === size) return
    shadow.mapSize.set(size, size)
    shadow.map?.dispose()
    shadow.map = null
  }

  /** Keep the shadow frustum centred on the ship as it strafes. */
  update(shipX: number): void {
    this.light.target.position.set(shipX, 0, 0)
    this.light.position.copy(this.direction).multiplyScalar(this.distance).add(this.light.target.position)
  }

  /**
   * Size the orthographic shadow camera so it exactly covers SHADOW_REGION as seen from the sun.
   * Uses the same basis three.js builds in lookAt, so the bounds match the real shadow camera.
   */
  private fitShadowFrustum(): void {
    _forward.copy(this.direction).negate()
    _right.crossVectors(_forward, WORLD_UP).normalize()
    _up.crossVectors(_right, _forward)

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const sx of [-1, 1]) {
      for (const sy of [0, 1]) {
        for (const z of [SHADOW_REGION.ahead, SHADOW_REGION.behind]) {
          _corner.set(sx * SHADOW_REGION.halfWidth, sy * SHADOW_REGION.height, z)
          const x = _corner.dot(_right)
          const y = _corner.dot(_up)
          const depth = _corner.dot(_forward)
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
          minZ = Math.min(minZ, depth)
          maxZ = Math.max(maxZ, depth)
        }
      }
    }

    const margin = 5
    const camera = this.light.shadow.camera
    camera.left = minX - margin
    camera.right = maxX + margin
    camera.bottom = minY - margin
    camera.top = maxY + margin
    camera.near = Math.max(0.1, this.distance + minZ - margin)
    camera.far = this.distance + maxZ + margin
    camera.updateProjectionMatrix()
  }
}
