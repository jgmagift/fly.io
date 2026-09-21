/** Frame-rate independent exponential approach of `current` toward `target`. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt)
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Uniform random number in [min, max). */
export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
