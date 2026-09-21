import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three'
import { PALETTE, SKY } from './constants'

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

    // Four-stop vertical gradient, warmest at the horizon, dusk blue overhead.
    vec3 color = mix(horizonColor, lowerColor, smoothstep(0.0, 0.12, y));
    color = mix(color, upperColor, smoothstep(0.12, 0.38, y));
    color = mix(color, zenithColor, smoothstep(0.38, 0.9, y));
    // Below the horizon fade to the fog colour so the ground's far edge never shows a seam.
    color = mix(color, horizonColor, smoothstep(0.0, 0.15, -y));

    // Warm glow around the sun, then the disc itself.
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

  constructor(sunDirection: Vector3) {
    this.sunDirection.copy(sunDirection).normalize()
    const material = new ShaderMaterial({
      uniforms: {
        horizonColor: { value: new Color(PALETTE.skyHorizon) },
        lowerColor: { value: new Color(PALETTE.skyLower) },
        upperColor: { value: new Color(PALETTE.skyUpper) },
        zenithColor: { value: new Color(PALETTE.skyZenith) },
        sunColor: { value: new Color(PALETTE.sunDisc) },
        glowColor: { value: new Color(PALETTE.sunGlow) },
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
  }

  /** Keep the dome centred on the camera so the gradient is a function of view direction only. */
  update(cameraPosition: Vector3): void {
    this.mesh.position.copy(cameraPosition)
  }
}
