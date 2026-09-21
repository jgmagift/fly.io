import { BufferAttribute, BufferGeometry } from 'three'

type Point = readonly [number, number, number]
type Triangle = readonly [Point, Point, Point]

export interface PlaneSpec {
  id: string
  name: string
  tagline: string
  hullColor: number
  accentColor: number
  /** Crashes the plane survives per run. */
  lives: number
  /** Top sideways speed, and how quickly it is reached and lost (per second). */
  maxLateralSpeed: number
  steerResponse: number
  steerDamping: number
  /** Collision half-width. A little smaller than the model, to be forgiving. */
  halfWidth: number
  /** Menu display only, 1 to 5. */
  stats: { agility: number; armor: number; slim: number }
  hull: Triangle[]
  accent: Triangle[]
  /** Right wingtip in model space. Trails stream from here and from its mirror image. */
  wingtip: Point
  trailColor: number
}

function mirrorPoint([x, y, z]: Point): Point {
  return [-x, y, z]
}

/** Each triangle plus its reflection across x = 0, with winding flipped so normals still face out. */
function mirrored(triangles: Triangle[]): Triangle[] {
  return triangles.flatMap((t): Triangle[] => [t, [mirrorPoint(t[0]), mirrorPoint(t[2]), mirrorPoint(t[1])]])
}

/**
 * A closed hull from the right-hand outline of the plane as seen from above.
 * `outline` runs from the nose to the tail and must start and end on the centre line.
 * The top is a fan over `spine`, the belly a fan over `keel`, and the left side is mirrored.
 */
function fanHull(outline: Point[], spine: Point, keel: Point): Triangle[] {
  const right: Triangle[] = []
  for (let i = 0; i < outline.length - 1; i++) {
    right.push([outline[i]!, spine, outline[i + 1]!])
    right.push([outline[i]!, outline[i + 1]!, keel])
  }
  return mirrored(right)
}

/** A thin swept fin centred on x = cx, built as a slab so it reads from behind. Points are [y, z]. */
function fin(
  cx: number,
  base: readonly [number, number],
  rear: readonly [number, number],
  tip: readonly [number, number],
  half = 0.06,
): Triangle[] {
  const at = (side: number, [y, z]: readonly [number, number]): Point => [cx + side * half, y, z]
  const bl = at(-1, base)
  const br = at(1, base)
  const rl = at(-1, rear)
  const rr = at(1, rear)
  const tl = at(-1, tip)
  const tr = at(1, tip)
  return [
    [bl, rl, tl],
    [br, tr, rr],
    [rl, rr, tr],
    [rl, tr, tl],
    [bl, tl, tr],
    [bl, tr, br],
  ]
}

interface PlaneDesign extends Omit<PlaneSpec, 'hull' | 'wingtip' | 'trailColor'> {
  /** Right-hand outline from nose to tail, as seen from above. Must sweep steadily rearward around the spine. */
  outline: Point[]
  spine: Point
  keel: Point
  trailColor?: number
}

function definePlane(design: PlaneDesign): PlaneSpec {
  const { outline, spine, keel, trailColor, ...rest } = design
  const wingtip = outline.reduce((widest, point) => (point[0] > widest[0] ? point : widest))
  return { ...rest, hull: fanHull(outline, spine, keel), wingtip, trailColor: trailColor ?? design.accentColor }
}

/** A matching pair of fins either side of the centre line. */
function finPair(...args: Parameters<typeof fin>): Triangle[] {
  const [cx, ...rest] = args
  return [...fin(cx, ...rest), ...fin(-cx, ...rest)]
}

/** All noses point down -z. Ordered roughly from simple to exotic; the last one is the best at everything. */
export const PLANES: readonly PlaneSpec[] = [
  definePlane({
    id: 'dart', name: 'DART', tagline: 'Balanced all-rounder',
    hullColor: 0xf7f5ef, accentColor: 0xe0572f,
    lives: 10, maxLateralSpeed: 40, steerResponse: 12, steerDamping: 6, halfWidth: 1.3,
    stats: { agility: 3, armor: 3, slim: 3 },
    outline: [[0, 0, -2.4], [1.7, 0, 1.0], [0, 0.1, 1.0]], spine: [0, 0.38, 0.9], keel: [0, -0.14, 1.0],
    accent: fin(0, [0.3, 0.1], [0.34, 0.95], [1.0, 1.1]),
  }),
  definePlane({
    id: 'manta', name: 'MANTA', tagline: 'Wide and tough, slow to turn',
    hullColor: 0x3d4f7a, accentColor: 0xffc857,
    lives: 14, maxLateralSpeed: 32, steerResponse: 8, steerDamping: 5, halfWidth: 2.1,
    stats: { agility: 2, armor: 4, slim: 1 },
    outline: [[0, 0, -1.9], [2.8, 0.06, 0.5], [1.0, 0, 1.25], [0, 0.08, 1.0]], spine: [0, 0.46, 0.3], keel: [0, -0.18, 0.5],
    accent: finPair(2.68, [0.05, 0.05], [0.05, 0.62], [0.6, 0.8], 0.05),
  }),
  definePlane({
    id: 'needle', name: 'NEEDLE', tagline: 'Razor thin and twitchy, fragile',
    hullColor: 0xffd166, accentColor: 0x26303f, trailColor: 0xffd166,
    lives: 6, maxLateralSpeed: 56, steerResponse: 16, steerDamping: 9, halfWidth: 0.75,
    stats: { agility: 4, armor: 1, slim: 5 },
    outline: [[0, 0, -3.1], [0.95, 0, 1.0], [0, 0.08, 1.05]], spine: [0, 0.34, 0.6], keel: [0, -0.12, 0.8],
    accent: fin(0, [0.28, 0.0], [0.3, 0.95], [1.25, 1.25]),
  }),
  definePlane({
    id: 'falcon', name: 'FALCON', tagline: 'Swept wings, quick and sharp',
    hullColor: 0xd64545, accentColor: 0xf7f5ef,
    lives: 8, maxLateralSpeed: 48, steerResponse: 14, steerDamping: 7, halfWidth: 1.6,
    stats: { agility: 4, armor: 2, slim: 2 },
    outline: [[0, 0, -2.3], [2.1, 0, 1.45], [0.75, 0, 0.75], [0, 0.12, 0.95]], spine: [0, 0.42, 0.4], keel: [0, -0.15, 0.6],
    accent: finPair(0.75, [0.15, 0.0], [0.12, 0.8], [0.8, 1.0]),
  }),
  definePlane({
    id: 'kite', name: 'KITE', tagline: 'Diamond wing, steady and honest',
    hullColor: 0x2ec4b6, accentColor: 0xfdfffc,
    lives: 9, maxLateralSpeed: 44, steerResponse: 12, steerDamping: 7, halfWidth: 1.5,
    stats: { agility: 3, armor: 3, slim: 2 },
    outline: [[0, 0, -1.9], [1.9, 0, -0.1], [0, 0.05, 1.5]], spine: [0, 0.4, 0.0], keel: [0, -0.14, 0.1],
    accent: fin(0, [0.3, 0.3], [0.2, 1.1], [0.85, 1.4]),
  }),
  definePlane({
    id: 'arrow', name: 'ARROW', tagline: 'Notched arrowhead, eager to turn',
    hullColor: 0x9b5de5, accentColor: 0xfee440,
    lives: 8, maxLateralSpeed: 46, steerResponse: 13, steerDamping: 8, halfWidth: 1.2,
    stats: { agility: 3, armor: 2, slim: 3 },
    outline: [[0, 0, -2.6], [1.5, 0, 1.2], [0.5, 0, 0.6], [0, 0.1, 0.8]], spine: [0, 0.36, 0.2], keel: [0, -0.13, 0.3],
    accent: fin(0, [0.28, -0.2], [0.26, 0.6], [0.9, 0.85]),
  }),
  definePlane({
    id: 'boomer', name: 'BOOMER', tagline: 'Flying wing, soaks up hits',
    hullColor: 0xf4a261, accentColor: 0x264653, trailColor: 0xf4a261,
    lives: 13, maxLateralSpeed: 36, steerResponse: 9, steerDamping: 5, halfWidth: 2.3,
    stats: { agility: 2, armor: 4, slim: 1 },
    outline: [[0, 0, -1.2], [3.0, 0.05, 1.0], [2.2, 0, 1.4], [0, 0.06, 0.3]], spine: [0, 0.36, -0.3], keel: [0, -0.14, -0.2],
    accent: finPair(2.9, [0.05, 0.75], [0.04, 1.2], [0.55, 1.4], 0.05),
  }),
  definePlane({
    id: 'stiletto', name: 'STILETTO', tagline: 'All nose, tiny wings, very quick',
    hullColor: 0xe9ecef, accentColor: 0x0077b6,
    lives: 7, maxLateralSpeed: 52, steerResponse: 15, steerDamping: 9, halfWidth: 1.0,
    stats: { agility: 4, armor: 2, slim: 4 },
    outline: [[0, 0, -3.4], [0.35, 0, -0.5], [1.3, 0, 1.1], [0, 0.08, 1.2]], spine: [0, 0.36, 0.4], keel: [0, -0.12, 0.5],
    accent: fin(0, [0.3, 0.1], [0.3, 1.05], [1.15, 1.35]),
  }),
  definePlane({
    id: 'heron', name: 'HERON', tagline: 'Long straight wings, floats through turns',
    hullColor: 0xffffff, accentColor: 0x3a86ff,
    lives: 12, maxLateralSpeed: 34, steerResponse: 8, steerDamping: 4, halfWidth: 2.4,
    stats: { agility: 2, armor: 4, slim: 1 },
    outline: [[0, 0, -2.0], [0.5, 0, -0.6], [3.2, 0.12, 0.0], [3.2, 0.12, 0.5], [0.5, 0, 0.9], [0, 0.08, 1.6]],
    spine: [0, 0.4, 0.2], keel: [0, -0.16, 0.2],
    accent: fin(0, [0.25, 0.7], [0.15, 1.5], [0.95, 1.75]),
  }),
  definePlane({
    id: 'viper', name: 'VIPER', tagline: 'Forward-swept and aggressive',
    hullColor: 0x38b000, accentColor: 0x1b1b1e, trailColor: 0x70e000,
    lives: 9, maxLateralSpeed: 54, steerResponse: 16, steerDamping: 9, halfWidth: 1.7,
    stats: { agility: 4, armor: 3, slim: 2 },
    outline: [[0, 0, -2.4], [0.6, 0, -0.2], [2.0, 0, -0.9], [1.1, 0, 1.0], [0, 0.1, 1.1]], spine: [0, 0.4, 0.3], keel: [0, -0.14, 0.4],
    accent: finPair(0.6, [0.2, 0.2], [0.15, 0.95], [0.8, 1.15]),
  }),
  definePlane({
    id: 'titan', name: 'TITAN', tagline: 'A flying brick that refuses to die',
    hullColor: 0x495057, accentColor: 0xff6b35,
    lives: 18, maxLateralSpeed: 30, steerResponse: 7, steerDamping: 5, halfWidth: 2.0,
    stats: { agility: 1, armor: 5, slim: 1 },
    outline: [[0, 0, -2.0], [1.2, 0, -1.0], [2.4, 0, 1.3], [0, 0.15, 1.5]], spine: [0, 0.7, 0.6], keel: [0, -0.3, 0.6],
    accent: finPair(1.0, [0.3, 0.3], [0.3, 1.2], [1.2, 1.5], 0.08),
  }),
  definePlane({
    id: 'wisp', name: 'WISP', tagline: 'Tiny and nervous, one mistake hurts',
    hullColor: 0xff99c8, accentColor: 0xfcf6bd,
    lives: 5, maxLateralSpeed: 58, steerResponse: 17, steerDamping: 10, halfWidth: 0.6,
    stats: { agility: 5, armor: 1, slim: 5 },
    outline: [[0, 0, -1.5], [0.9, 0, 0.6], [0, 0.05, 0.65]], spine: [0, 0.24, 0.5], keel: [0, -0.08, 0.55],
    accent: fin(0, [0.2, 0.0], [0.2, 0.6], [0.65, 0.75], 0.04),
  }),
  definePlane({
    id: 'raptor', name: 'RAPTOR', tagline: 'Double delta, fast hands, solid frame',
    hullColor: 0x1d3557, accentColor: 0xe63946,
    lives: 11, maxLateralSpeed: 56, steerResponse: 16, steerDamping: 9, halfWidth: 1.6,
    stats: { agility: 5, armor: 4, slim: 2 },
    outline: [[0, 0, -2.8], [0.5, 0, -1.2], [0.9, 0, -0.2], [2.3, 0, 1.2], [0.8, 0, 0.9], [0, 0.1, 1.1]],
    spine: [0, 0.42, 0.2], keel: [0, -0.15, 0.3],
    accent: finPair(0.7, [0.2, 0.1], [0.14, 0.9], [0.95, 1.2]),
  }),
  definePlane({
    id: 'aurora', name: 'AURORA', tagline: 'Flawless. The best at everything',
    hullColor: 0xf8f9fa, accentColor: 0xffd60a, trailColor: 0x7df9ff,
    lives: 20, maxLateralSpeed: 66, steerResponse: 20, steerDamping: 12, halfWidth: 0.7,
    stats: { agility: 5, armor: 5, slim: 5 },
    outline: [[0, 0, -3.0], [0.45, 0, -1.0], [2.0, 0.04, 1.0], [1.0, 0, 0.8], [0.35, 0, 1.35], [0, 0.1, 1.2]],
    spine: [0, 0.4, 0.2], keel: [0, -0.13, 0.3],
    accent: [...fin(0, [0.32, 0.0], [0.3, 0.95], [1.05, 1.3]), ...finPair(1.9, [0.04, 0.55], [0.04, 0.98], [0.5, 1.15], 0.05)],
  }),
]

/** Geometry with two material groups: 0 is the hull, 1 is the accent parts. */
export function buildPlaneGeometry(plane: PlaneSpec): BufferGeometry {
  const hull = plane.hull.flat(2)
  const accent = plane.accent.flat(2)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([...hull, ...accent]), 3))
  geometry.addGroup(0, hull.length / 3, 0)
  geometry.addGroup(hull.length / 3, accent.length / 3, 1)
  geometry.computeVertexNormals()
  return geometry
}

const STORAGE_KEY = 'fly.plane'

/** Index of the plane chosen last time, or 0. Storage can be blocked, so failures fall back quietly. */
export function loadPlaneIndex(): number {
  try {
    const index = PLANES.findIndex((plane) => plane.id === localStorage.getItem(STORAGE_KEY))
    return index < 0 ? 0 : index
  } catch {
    return 0
  }
}

export function savePlaneIndex(index: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, PLANES[index]!.id)
  } catch {
    // Not being able to remember the choice is harmless.
  }
}
