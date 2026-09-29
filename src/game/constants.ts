/** Tunable gameplay values. Distances are world units (roughly metres), times are seconds. */
export const SHIP = {
  forwardSpeed: 100,
  maxSpeed: 160,
  /** Extra forward speed gained per unit of distance flown. */
  speedRamp: 0.006,
  /** Roll at full lateral speed, in radians. */
  maxBank: 0.7,
  bankResponse: 8,
  /** Yaw into the turn at full lateral speed, in radians. */
  maxYaw: 0.18,
  hoverHeight: 1.1,
} as const

export const GAME = {
  /** World scroll speed behind the menu. */
  menuSpeed: 45,
  /** Slower in VR, where standing still while the ground rushes past is hard on the stomach. */
  vrMenuSpeed: 18,
  /** Score is distance times the multiplier. The multiplier climbs by one for each stretch flown without a crash. */
  multiplierDistance: 600,
  maxMultiplier: 8,
  /** Seconds of blinking immunity after a crash, so one obstacle never costs two lives. */
  invulnerableTime: 1.5,
  /** Seconds after game over before a press restarts, so a held steering touch does not skip the screen. */
  restartDelay: 0.8,
  /** Ship collision box half-depth. The half-width comes from the selected plane. */
  shipHalfDepth: 1.6,
  /** Resuming from pause counts down 3, 2, 1, so the player has a moment to get ready. */
  resumeSteps: 3,
  resumeStepSeconds: 0.6,
  /** How quickly the VR comfort vignette closes in and opens up (per second). */
  comfortResponse: 6,
} as const

export const CAMERA = {
  fov: 58,
  near: 0.1,
  far: 900,
  /** Fraction of the ship's bank the chase views copy, for a subtle lean. */
  bankFollow: 0.12,
  /** Maximum camera offset at full shake, and how fast shake dies away (per second). */
  shakeDistance: 0.9,
  shakeDecay: 5,
  /** Menu view: the camera sways around the hovering plane at this radius and height. */
  showcaseRadius: 8.5,
  showcaseHeight: 3.0,
  showcaseLookY: 0.8,
  /** Sway half-angle in radians and its speed. Kept small so the camera never sees behind the world. */
  showcaseSwing: 0.6,
  showcaseSwingSpeed: 0.35,
  /** How quickly the camera glides between views (per second). */
  modeBlend: 3,
  /** Cockpit eye point: this far along the plane (negative is toward the nose), this high above the hull. */
  cockpitZ: -0.3,
  cockpitEyeHeight: 0.35,
  /** Slight nose-down tilt of the cockpit view, in radians, so the nose shows at the bottom of the screen. */
  cockpitPitch: -0.05,
  /** Share of the plane's bank the cockpit view rolls with. Full roll tilts the horizon too far to read while weaving. */
  cockpitRoll: 0.6,
  /** VR menu: where the player's eyes are, relative to the hovering plane. */
  vrShowcaseHeight: 1.9,
  vrShowcaseBack: 5.2,
} as const

export type CameraView = 'far' | 'chase' | 'near' | 'cockpit'

interface CameraViewSpec {
  label: string
  /** Eye height and distance behind the ship. In VR this is exactly where the player's eyes are. */
  height: number
  back: number
  /** Flat screen only: the point the camera aims at, relative to the ship's ground position. */
  lookY: number
  lookAhead: number
  fov: number
}

/**
 * Views available during a run. The cockpit eye point comes from each plane's shape, so the cockpit's
 * position fields only matter while blending; they copy the near view, the closest chase view.
 */
export const CAMERA_VIEWS: Record<CameraView, CameraViewSpec> = {
  far: { label: 'FAR', height: 11, back: 26, lookY: 1, lookAhead: -70, fov: 55 },
  chase: { label: 'CHASE', height: 5.5, back: 13, lookY: 1.2, lookAhead: -40, fov: 58 },
  near: { label: 'NEAR', height: 2.7, back: 6.5, lookY: 1.5, lookAhead: -30, fov: 64 },
  cockpit: { label: 'COCKPIT', height: 2.7, back: 6.5, lookY: 1.5, lookAhead: -30, fov: 74 },
}

/** The order the camera button steps through, from farthest to closest. */
export const CAMERA_VIEW_ORDER: readonly CameraView[] = ['far', 'chase', 'near', 'cockpit']

export const WORLD = {
  seed: 1337,
  chunkLength: 200,
  chunkWidth: 800,
  chunkCount: 7,
  groundSegmentsX: 40,
  groundSegmentsZ: 10,
  /** Half-width of the flat strip the ship can fly in. Hills start just outside it. */
  playHalfWidth: 140,
  maxBoxesPerChunk: 24,
  maxPyramidsPerChunk: 10,
  /** Chunks with an index below this are kept empty so every run starts calmly. */
  calmChunks: 2,
  /** Minimum clearance kept between obstacles so there is always a way through. */
  obstacleGap: 4,
  /** Recycle a chunk once its far edge is this far behind the ship. */
  recycleBehind: 40,
  /** Shift everything back toward the origin once we have scrolled this far, to keep float precision. */
  rebaseDistance: 4000,
} as const

export const SKY = {
  radius: 750,
  /** Angular radius of the sun disc, in degrees. Far bigger than real life, on purpose. */
  sunDiscDegrees: 4,
  fogNear: 140,
  fogFar: 540,
} as const

export const PALETTE = {
  skyZenith: 0x2b3766,
  skyUpper: 0x7f5f95,
  skyLower: 0xe0836f,
  skyHorizon: 0xf6b57d,
  sunDisc: 0xfff4d6,
  sunGlow: 0xffd39a,
  fog: 0xf6b57d,
  ground: 0xcdb394,
  obstacle: 0x201d24,
  ship: 0xf7f5ef,
  shipAccent: 0xe0572f,
  sunLight: 0xffb474,
  hemiSky: 0x7c72ad,
  hemiGround: 0x6e5643,
} as const
