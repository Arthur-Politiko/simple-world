import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { chatJSON, REFLECTION_MODEL } from './llm'
import { applyReflectionProposal, getCharacterMemory, type CharacterMemory } from './memory'
import { getWorldState, RuleError, type CharacterRow, type EventRow } from './world'
import { recordLLMCall } from './metrics'

const REFLECTION_SYSTEM = `Ты — модуль рефлексии NPC в симуляции средневековой деревни. По описанию персонажа и события определи, что персонаж узнал и как это на него влияет. Верни СТРОГО JSON (без текста вне JSON) по схеме:

{
  "reason": "строка — почему событие важно/не важно для персонажа (обязательно)",
  "currentState": "строка — текущее эмоциональное/физическое состояние (опционально)",
  "core": "строка — обновлённое ядро личности (только если событие меняет характер; опционально)",
  "entries": [{"kind": "recent"|"significant", "content": "строка", "importance": 0..100}],
  "relationships": [{"targetId": "строка", "note": "строка", "trust": -100..100}],
  "beliefs": [{"statement": "строка", "status": "believed"|"uncertain"|"rejected", "confidence": 0..100}]
}

Правила:
- «reason» обязателен; остальные поля опускай, если изменений нет.
- Слух — не факт: сохраняй его как убеждение (status), а не как достоверное знание.
- Не выдумывай события мира; опирайся только на описание события и знания персонажа.
- Отвечай согласованно с ядром личности персонажа.`

function describeCharacter(c: CharacterRow, memory: CharacterMemory): string {
  const beliefs = memory.beliefs.length
    ? memory.beliefs.map((b) => `- ${b.status}: «${b.statement}» (уверенность ${b.confidence})`).join('\n')
    : '—'
  return [
    `Имя: ${c.name}`,
    `Роль: ${c.role}`,
    `Ядро личности: ${memory.core || '— не сформировано —'}`,
    `Текущее состояние: ${memory.currentState || '—'}`,
    `Убеждения:\n${beliefs}`,
  ].join('\n')
}

function describeEvent(e: EventRow): string {
  return `День ${e.day}, тип «${e.type}»: ${JSON.stringify(e.payload)}`
}

/** Задаёт начальное ядро персонажа через штатный протокол рефлексии (revision 0 → 1). */
export function seedCharacterCore(db: DatabaseSync, worldId: string, characterId: string, core: string): number {
  const state = getWorldState(db, worldId)
  const created = state.events.find((e) => e.type === 'world_created')
  if (!created) throw new RuleError('нет события world_created')
  const result = applyReflectionProposal(db, {
    worldId,
    characterId,
    proposalId: `seed-${characterId}-${randomUUID()}`,
    expectedRevision: 0,
    eventId: created.id,
    reason: 'Начальное ядро личности (этап 6)',
    core,
  })
  return result.revision
}

export interface ReflectionOutcome {
  proposalId: string
  revision: number
  reason: string
  eventId: number
  memory: CharacterMemory
}

/**
 * Полный вертикальный срез рефлексии: контекст → модель → proposal → атомарное применение.
 * Реальный вызов выполняется только при наличии ключа в окружении.
 */
export async function reflectOnEvent(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
  eventId: number,
): Promise<ReflectionOutcome> {
  const state = getWorldState(db, worldId)
  const character = state.characters.find((c) => c.id === characterId)
  if (!character) throw new RuleError(`персонаж не найден: ${characterId}`)
  const event = state.events.find((e) => e.id === eventId)
  if (!event) throw new RuleError(`событие не найдено: ${eventId}`)
  const memory = getCharacterMemory(db, worldId, characterId)
  const knowledge = state.knowledge.filter((k) => k.character_id === characterId)

  const user = [
    'ПЕРСОНАЖ',
    describeCharacter(character, memory),
    '',
    'СОБЫТИЕ',
    describeEvent(event),
    '',
    'ЗНАНИЕ ПЕРСОНАЖА',
    knowledge.length ? knowledge.map((k) => `- [${k.source}] ${k.summary}`).join('\n') : '—',
    '',
    'Верни JSON-предложение рефлексии.',
  ].join('\n')

  const { value, usage } = await chatJSON<Record<string, unknown>>(
    REFLECTION_MODEL,
    [
      { role: 'system', content: REFLECTION_SYSTEM },
      { role: 'user', content: user },
    ],
    { maxTokens: 4000, temperature: 0.6 },
  )
  recordLLMCall(db, 'reflection', usage)

  const content = value as {
    reason?: unknown
    core?: unknown
    currentState?: unknown
    entries?: unknown
    relationships?: unknown
    beliefs?: unknown
  }
  const proposalId = randomUUID()
  const applied = applyReflectionProposal(db, {
    worldId,
    characterId,
    proposalId,
    expectedRevision: memory.revision,
    eventId,
    reason: content.reason,
    ...(content.core !== undefined ? { core: content.core } : {}),
    ...(content.currentState !== undefined ? { currentState: content.currentState } : {}),
    ...(content.entries !== undefined ? { entries: content.entries } : {}),
    ...(content.relationships !== undefined ? { relationships: content.relationships } : {}),
    ...(content.beliefs !== undefined ? { beliefs: content.beliefs } : {}),
  })

  return {
    proposalId,
    revision: applied.revision,
    reason: typeof content.reason === 'string' ? content.reason : '',
    eventId,
    memory: getCharacterMemory(db, worldId, characterId),
  }
}
