import type { DatabaseSync } from 'node:sqlite'
import { advancePhase, getWorldState, type CharacterRow, type WorldState } from './world'
import { chooseIntention } from './agent'
import { loadLLMConfig } from './llm'

/** Персонажи в «значимом узле»: голод (нет еды) или незавершённое обязательство в ближайшие 2 дня. */
export function significantCharacters(db: DatabaseSync, worldId: string): CharacterRow[] {
  const state = getWorldState(db, worldId)
  const day = state.world.day
  return state.characters.filter((c) => {
    const hasFood = state.stock.some(
      (s) =>
        s.holder_type === 'character' &&
        s.holder_id === c.id &&
        (s.resource === 'зерно' || s.resource === 'рыба') &&
        s.quantity > 0,
    )
    const obligationSoon = state.obligations.some(
      (o) => o.character_id === c.id && o.status === 'pending' && o.due_day <= day + 2,
    )
    return !hasFood || obligationSoon
  })
}

export interface AutonomyResult {
  state: WorldState
  decisions: Array<Awaited<ReturnType<typeof chooseIntention>>>
}

/**
 * Прогон дней с автономным выбором NPC в значимых узлах.
 * LLM-вызовы выполняются только при наличии ключа; число решений ограничено maxPerDay.
 */
export async function runDaysWithAutonomy(
  db: DatabaseSync,
  worldId: string,
  days: number,
  maxPerDay = 1,
): Promise<AutonomyResult> {
  const decisions: Array<Awaited<ReturnType<typeof chooseIntention>>> = []
  const llmEnabled = loadLLMConfig() !== null

  for (let d = 0; d < days; d++) {
    for (let p = 0; p < 4; p++) advancePhase(db, worldId)

    if (llmEnabled) {
      const significant = significantCharacters(db, worldId)
      for (const c of significant.slice(0, maxPerDay)) {
        decisions.push(await chooseIntention(db, worldId, c.id))
      }
    }
  }

  return { state: getWorldState(db, worldId), decisions }
}
