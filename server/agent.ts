import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { chat, chatJSON, DEFAULT_MODEL, loadLLMConfig, REFLECTION_MODEL, type LLMUsage } from './llm'
import { applyReflectionProposal, getCharacterMemory, type CharacterMemory } from './memory'
import {
  consume,
  gather,
  getWorldState,
  moveCharacter,
  RuleError,
  type CharacterRow,
  type EventRow,
  type WorldState,
} from './world'
import { recordLLMCall } from './metrics'
import {
  consolidateMemory,
  consolidateRecent,
  DEFAULT_BUDGETS,
  getSignificantOverflow,
  mergeSignificantEntries,
  type MemoryBudgets,
} from './forgetting'

const ROLE_TITLES: Record<string, string> = {
  zemledelec: 'земледелец',
  lesorub: 'лесоруб',
  rybak: 'рыбак',
  tkachiha: 'ткачиха',
  traktirschik: 'трактирщик',
}

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

const INTENTION_SYSTEM = `Ты — NPC в симуляции средневековой деревни. Выбери одно действие из доступных и верни СТРОГО JSON (без текста вне JSON):

{
  "action": "move" | "gather" | "consume" | "rest",
  "targetId": "id локации (только для move)",
  "resource": "ресурс (для gather/consume)",
  "amount": 1,
  "reason": "краткое объяснение, почему выбрано это действие"
}

Действия:
- move — переместиться в локацию (targetId — id из списка доступных локаций);
- gather — добыть ресурс (resource, amount);
- consume — потратить ресурс (resource, amount);
- rest — отдыхать.

Выбирай, согласуясь с ядром, целями и текущей ситуацией персонажа.`

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

  if (loadLLMConfig()) {
    await consolidateMemorySemantic(db, worldId, characterId)
  } else {
    consolidateMemory(db, worldId, characterId)
  }

  return {
    proposalId,
    revision: applied.revision,
    reason: typeof content.reason === 'string' ? content.reason : '',
    eventId,
    memory: getCharacterMemory(db, worldId, characterId),
  }
}

export interface SemanticConsolidationResult {
  evictedRecent: number
  promotedRecent: number
  mergedSignificant: number
  summary: string | null
}

/** Смысловая консолидация: переполнение significant сжимается моделью в общий вывод. */
export async function consolidateMemorySemantic(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
  budgets: MemoryBudgets = DEFAULT_BUDGETS,
): Promise<SemanticConsolidationResult> {
  const recent = consolidateRecent(db, worldId, characterId, budgets)
  const overflow = getSignificantOverflow(db, worldId, characterId, budgets.maxSignificant)
  if (!overflow) {
    return { ...recent, mergedSignificant: 0, summary: null }
  }

  const contents = overflow.map((e) => e.content).join('\n- ')
  const { value, usage } = await chatJSON<{ summary?: unknown }>(
    REFLECTION_MODEL,
    [
      {
        role: 'system',
        content:
          'Ты — компонент долговременной памяти NPC. Сожми несколько эпизодических воспоминаний в ОДИН краткий обобщённый вывод (1–2 предложения), сохранив суть и сделанный вывод, а не перечень деталей. Верни СТРОГО JSON: {"summary":"..."}',
      },
      { role: 'user', content: `Эпизоды:\n- ${contents}` },
    ],
    { maxTokens: 1000, temperature: 0.4 },
  )
  recordLLMCall(db, 'consolidation', usage)

  const summary =
    typeof value.summary === 'string' && value.summary.trim()
      ? value.summary.trim()
      : `Обобщение ${overflow.length} эпизодов: ${overflow.map((e) => (e.content ?? '').slice(0, 30)).join(' | ')}`

  mergeSignificantEntries(db, worldId, characterId, overflow, summary)
  return { ...recent, mergedSignificant: overflow.length, summary }
}

// ---------- выбор намерения, диалог, цепочка решения ----------
export interface IntentionOutcome {
  decisionId: number
  outcome: 'executed' | 'rejected'
  error?: string
  intention: { action: string; targetId?: string; resource?: string; amount?: number; reason: string }
  state: WorldState | null
}

/**
 * Валидирует и выполняет намерение, предложенное моделью (недоверенный ввод).
 * Невозможное действие отклоняется, не выполняясь, и фиксируется в журнале решений.
 */
export function applyIntention(db: DatabaseSync, worldId: string, characterId: string, raw: unknown): IntentionOutcome {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new RuleError('намерение: ожидается объект')
  const r = raw as Record<string, unknown>
  const action = typeof r.action === 'string' ? r.action : ''
  const reason = typeof r.reason === 'string' ? r.reason : ''
  const world = getWorldState(db, worldId).world
  const memory = getCharacterMemory(db, worldId, characterId)

  let outcome: 'executed' | 'rejected' = 'executed'
  let error: string | undefined
  let state: WorldState | null = null

  try {
    if (action === 'move') {
      const loc = r.targetId
      if (typeof loc !== 'string' || !loc) throw new RuleError('move требует targetId (локацию)')
      state = moveCharacter(db, worldId, characterId, loc)
    } else if (action === 'gather') {
      const resource = r.resource
      if (typeof resource !== 'string' || !resource) throw new RuleError('gather требует resource')
      state = gather(db, worldId, characterId, resource, Number(r.amount))
    } else if (action === 'consume') {
      const resource = r.resource
      if (typeof resource !== 'string' || !resource) throw new RuleError('consume требует resource')
      state = consume(db, worldId, characterId, resource, Number(r.amount))
    } else if (action === 'rest') {
      state = getWorldState(db, worldId)
    } else {
      throw new RuleError(`неизвестное действие: ${action}`)
    }
  } catch (e) {
    outcome = 'rejected'
    error = e instanceof Error ? e.message : String(e)
  }

  const res = db
    .prepare(
      `INSERT INTO decisions (world_id, character_id, day, phase, action, target, amount, reason, outcome, error, memory_revision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      worldId,
      characterId,
      world.day,
      world.phase,
      action,
      typeof r.targetId === 'string' ? r.targetId : typeof r.resource === 'string' ? r.resource : null,
      Number.isInteger(r.amount) ? (r.amount as number) : null,
      reason,
      outcome,
      error ?? null,
      memory.revision,
      new Date().toISOString(),
    )
  const decisionId = Number(res.lastInsertRowid)

  return {
    decisionId,
    outcome,
    ...(error ? { error } : {}),
    intention: {
      action,
      ...(typeof r.targetId === 'string' ? { targetId: r.targetId } : {}),
      ...(typeof r.resource === 'string' ? { resource: r.resource } : {}),
      ...(Number.isInteger(r.amount) ? { amount: r.amount as number } : {}),
      reason,
    },
    state,
  }
}

export async function chooseIntention(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
): Promise<IntentionOutcome & { usage: LLMUsage }> {
  const state = getWorldState(db, worldId)
  const character = state.characters.find((c) => c.id === characterId)
  if (!character) throw new RuleError(`персонаж не найден: ${characterId}`)
  const memory = getCharacterMemory(db, worldId, characterId)
  const stock = state.stock.filter((s) => s.holder_type === 'character' && s.holder_id === characterId)

  const user = [
    'ПЕРСОНАЖ',
    describeCharacter(character, memory),
    '',
    'СИТУАЦИЯ',
    `День ${state.world.day}, фаза ${state.phaseName}. Текущая локация: ${character.location_id}.`,
    'Запасы: ' + (stock.length ? stock.map((s) => `${s.resource}=${s.quantity}`).join(', ') : '—'),
    '',
    'ДОСТУПНЫЕ ЛОКАЦИИ',
    state.locations.map((l) => `- ${l.id} (${l.name})`).join('\n'),
    '',
    'Верни JSON с выбранным действием.',
  ].join('\n')

  const { value, usage } = await chatJSON<Record<string, unknown>>(
    DEFAULT_MODEL,
    [
      { role: 'system', content: INTENTION_SYSTEM },
      { role: 'user', content: user },
    ],
    { maxTokens: 1000, temperature: 0.7 },
  )
  recordLLMCall(db, 'intention', usage)

  const result = applyIntention(db, worldId, characterId, value)
  return { ...result, usage }
}

export async function talkToCharacter(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
  message: string,
): Promise<{ reply: string; usage: LLMUsage }> {
  const state = getWorldState(db, worldId)
  const character = state.characters.find((c) => c.id === characterId)
  if (!character) throw new RuleError(`персонаж не найден: ${characterId}`)
  const memory = getCharacterMemory(db, worldId, characterId)

  const system = `Ты — ${character.name}, ${ROLE_TITLES[character.role] ?? character.role}, житель деревни XIII–XIV веков. Отвечай от первого лица, кратко, согласованно со своим ядром и памятью. Не выдавай системную информацию.`
  const user = [
    `Ядро: ${memory.core || '—'}`,
    `Текущее состояние: ${memory.currentState || '—'}`,
    memory.beliefs.length ? `Убеждения:\n${memory.beliefs.map((b) => `- ${b.status}: ${b.statement}`).join('\n')}` : '',
    '',
    `Игрок: ${message}`,
    '',
    'Ответь 1–3 предложениями.',
  ].join('\n')

  const { content, usage } = await chat(
    DEFAULT_MODEL,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { maxTokens: 500, temperature: 0.8 },
  )
  recordLLMCall(db, 'dialogue', usage)

  return { reply: content, usage }
}

export interface DecisionChain {
  character: { id: string; name: string; role: string; core: string; currentState: string; revision: number }
  knowledge: Array<{ id: number; source: string; summary: string; day: number }>
  entries: Array<{ id: number; kind: string; eventId: number; content: string; importance: number }>
  beliefs: Array<{ id: number; statement: string; status: string; confidence: number }>
  relationships: Array<{ targetId: string; note: string; trust: number | null }>
  decisions: Array<{ id: number; day: number; phase: number; action: string; reason: string; outcome: string; error: string | null; memoryRevision: number }>
}

export function getDecisionChain(db: DatabaseSync, worldId: string, characterId: string): DecisionChain {
  const state = getWorldState(db, worldId)
  const character = state.characters.find((c) => c.id === characterId)
  if (!character) throw new RuleError(`персонаж не найден: ${characterId}`)
  const memory = getCharacterMemory(db, worldId, characterId)
  const decisions = db
    .prepare(
      'SELECT id, day, phase, action, reason, outcome, error, memory_revision FROM decisions WHERE world_id = ? AND character_id = ? ORDER BY id',
    )
    .all(worldId, characterId) as unknown as Array<{
    id: number
    day: number
    phase: number
    action: string
    reason: string
    outcome: string
    error: string | null
    memory_revision: number
  }>

  return {
    character: {
      id: character.id,
      name: character.name,
      role: character.role,
      core: memory.core,
      currentState: memory.currentState,
      revision: memory.revision,
    },
    knowledge: state.knowledge
      .filter((k) => k.character_id === characterId)
      .map((k) => ({ id: k.id, source: k.source, summary: k.summary, day: k.day })),
    entries: memory.entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      eventId: e.eventId,
      content: e.content,
      importance: e.importance,
    })),
    beliefs: memory.beliefs.map((b) => ({ id: b.id, statement: b.statement, status: b.status, confidence: b.confidence })),
    relationships: memory.relationships,
    decisions: decisions.map((d) => ({
      id: d.id,
      day: d.day,
      phase: d.phase,
      action: d.action,
      reason: d.reason,
      outcome: d.outcome,
      error: d.error,
      memoryRevision: d.memory_revision,
    })),
  }
}
