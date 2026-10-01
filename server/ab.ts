import type { DatabaseSync } from 'node:sqlite'
import { createWorld, getWorldState, moveCharacter, runDays } from './world'
import { seedCharacterCore, reflectOnEvent, talkToCharacter } from './agent'
import { getCharacterMemory } from './memory'

export interface ABComparisonResult {
  question: string
  event: { id: number; type: string; day: number }
  reflective: { characterId: string; revision: number; beliefs: string[]; reply: string }
  static: { characterId: string; revision: number; beliefs: string[]; reply: string }
}

/**
 * A/B-эксперимент: два персонажа с одинаковым ядром переживают одно событие.
 * Один рефлексирует (память меняется), второй — нет. Затем оба отвечают на один вопрос.
 * Механическую разницу проверяет тест; качественную — человек.
 */
export async function runABComparison(db: DatabaseSync, seed = 7): Promise<ABComparisonResult> {
  const s = createWorld(db, 'AB-тест', seed)
  const id = s.world.id

  const core = 'Доверяет людям, считает сеньора справедливым, склонен верить хорошим новостям.'
  seedCharacterCore(db, id, 'chr-marta', core)
  seedCharacterCore(db, id, 'chr-tomas', core)

  // оба идут в трактир и слышат ложный слух
  moveCharacter(db, id, 'chr-marta', 'loc-inn')
  moveCharacter(db, id, 'chr-tomas', 'loc-inn')
  runDays(db, id, 8) // день 9 — слух

  const state = getWorldState(db, id)
  const newsEvent = state.events.find(
    (e) =>
      e.type === 'news' &&
      typeof e.payload === 'object' &&
      (e.payload as { isTrue?: boolean }).isTrue === false,
  )
  if (!newsEvent) throw new Error('нет события ложного слуха')

  // рефлексивный персонаж осмысляет слух; статический — нет
  await reflectOnEvent(db, id, 'chr-marta', newsEvent.id)

  const question = 'Что ты думаешь о слухе, будто сеньор отменит оброк?'
  const martaReply = await talkToCharacter(db, id, 'chr-marta', question)
  const tomasReply = await talkToCharacter(db, id, 'chr-tomas', question)

  const martaMemory = getCharacterMemory(db, id, 'chr-marta')
  const tomasMemory = getCharacterMemory(db, id, 'chr-tomas')

  return {
    question,
    event: { id: newsEvent.id, type: newsEvent.type, day: newsEvent.day },
    reflective: {
      characterId: 'chr-marta',
      revision: martaMemory.revision,
      beliefs: martaMemory.beliefs.map((b) => b.statement),
      reply: martaReply.reply,
    },
    static: {
      characterId: 'chr-tomas',
      revision: tomasMemory.revision,
      beliefs: tomasMemory.beliefs.map((b) => b.statement),
      reply: tomasReply.reply,
    },
  }
}
