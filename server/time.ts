export const PHASES = ['утро', 'день', 'вечер', 'ночь'] as const
export type PhaseName = (typeof PHASES)[number]

export function phaseName(index: number): PhaseName {
  return PHASES[((index % PHASES.length) + PHASES.length) % PHASES.length]
}

export interface TimePoint {
  day: number
  phase: number
}

/** Продвинуть фазу; при переходе через «ночь» увеличивается день. */
export function advanceTime(day: number, phase: number): TimePoint {
  const total = day * PHASES.length + phase + 1
  return {
    day: Math.floor(total / PHASES.length),
    phase: total % PHASES.length,
  }
}
