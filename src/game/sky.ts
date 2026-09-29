import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three'
import { SKY } from './constants'
import type { WorldTheme } from './worlds'

const vertexShader = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldDir = worldPosition.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 horizonColor;
  uniform vec3 lowerColor;
  uniform vec3 upperColor;
  uniform vec3 zenithColor;
  uniform vec3 sunColor;
  uniform vec3 glowColor;
  uniform vec3 sunDirection;
  uniform float sunDiscCos;
  varying vec3 vWorldDir;

  void main() {
    vec3 dir = normalize(vWorldDir);
    float y = dir.y;

    // Four-stop vertical gradient from the horizon up to the zenith.
    vec3 color = mix(horizonColor, lowerColor, smoothstep(0.0, 0.12, y));
    color = mix(color, upperColor, smoothstep(0.12, 0.38, y));
    color = mix(color, zenithColor, smoothstep(0.38, 0.9, y));
    // Below the horizon fade to the fog colour so the ground's far edge never shows a seam.
    color = mix(color, horizonColor, smoothstep(0.0, 0.15, -y));

    // Glow around the sun, then the disc itself.
    float toSun = max(dot(dir, sunDirection), 0.0);
    color = mix(color, glowColor, pow(toSun, 8.0) * 0.6 + pow(toSun, 2.0) * 0.12);
    float disc = smoothstep(sunDiscCos - 0.0012, sunDiscCos + 0.0004, dot(dir, sunDirection));
    color = mix(color, sunColor, disc);

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

/** A gradient dome with a sun disc that follows the camera. Unlit and unfogged. */
export class Sky {
  readonly mesh: Mesh
  private readonly sunDirection = new Vector3()
  private readonly colors = {
    horizonColor: new Color(),
    lowerColor: new Color(),
    upperColor: new Color(),
    zenithColor: new Color(),
    sunColor: new Color(),
    glowColor: new Color(),
  }

  constructor(theme: WorldTheme) {
    const material = new ShaderMaterial({
      uniforms: {
        horizonColor: { value: this.colors.horizonColor },
        lowerColor: { value: this.colors.lowerColor },
        upperColor: { value: this.colors.upperColor },
        zenithColor: { value: this.colors.zenithColor },
        sunColor: { value: this.colors.sunColor },
        glowColor: { value: this.colors.glowColor },
        sunDirection: { value: this.sunDirection },
        sunDiscCos: { value: Math.cos((SKY.sunDiscDegrees * Math.PI) / 180) },
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      fog: false,
    })
    this.mesh = new Mesh(new SphereGeometry(SKY.radius, 32, 16), material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1
    this.setTheme(theme)
  }

  /** Recolour the dome and move the sun. The uniforms hold these objects, so they update in place. */
  setTheme(theme: WorldTheme): void {
    const { palette } = theme
    this.colors.horizonColor.setHex(palette.skyHorizon)
    this.colors.lowerColor.setHex(palette.skyLower)
    this.colors.upperColor.setHex(palette.skyUpper)
    this.colors.zenithColor.setHex(palette.skyZenith)
    this.colors.sunColor.setHex(palette.sunDisc)
    this.colors.glowColor.setHex(palette.sunGlow)
    this.sunDirection.set(...theme.sunDirection).normalize()
  }

  /** Keep the dome centred on the camera so the gradient is a function of view direction only. */
  update(cameraPosition: Vector3): void {
    this.mesh.position.copy(cameraPosition)
  }
}
