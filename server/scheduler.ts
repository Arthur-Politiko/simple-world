import type { DatabaseSync } from 'node:sqlite'
import { advancePhase } from './world'

export interface AutoState {
  running: boolean
  intervalMs: number
}

/** Серверный планировщик авто-продвижения: деревня живёт независимо от браузера. */
const timers = new Map<string, { timer: NodeJS.Timeout; intervalMs: number }>()

export function startAuto(db: DatabaseSync, worldId: string, intervalMs: number): AutoState {
  stopAuto(worldId)
  const timer = setInterval(() => {
    try {
      advancePhase(db, worldId)
    } catch {
      stopAuto(worldId)
    }
  }, intervalMs)
  timers.set(worldId, { timer, intervalMs })
  return { running: true, intervalMs }
}

export function stopAuto(worldId: string): AutoState {
  const entry = timers.get(worldId)
  if (entry) {
    clearInterval(entry.timer)
    timers.delete(worldId)
  }
  return { running: false, intervalMs: 0 }
}

export function getAuto(worldId: string): AutoState {
  const entry = timers.get(worldId)
  return entry ? { running: true, intervalMs: entry.intervalMs } : { running: false, intervalMs: 0 }
}
