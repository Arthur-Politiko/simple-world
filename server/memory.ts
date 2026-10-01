import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { RuleError } from './world'

export type MemoryEntryKind = 'recent' | 'significant'
export type BeliefStatus = 'believed' | 'uncertain' | 'rejected'

export interface MemoryEntryInput {
  kind: MemoryEntryKind
  content: string
  importance: number
  knowledgeId?: number
}

export interface RelationshipInput {
  targetId: string
  note: string
  trust?: number | null
}

export interface BeliefInput {
  statement: string
  status: BeliefStatus
  confidence: number
  knowledgeId?: number
}

/** Untrusted proposal produced by a reflection step or test adapter. */
export interface ReflectionProposal {
  worldId: string
  characterId: string
  proposalId: string
  expectedRevision: number
  eventId: number
  reason: string
  core?: string
  currentState?: string
  entries?: MemoryEntryInput[]
  relationships?: RelationshipInput[]
  beliefs?: BeliefInput[]
}

export interface NormalizedProposal extends ReflectionProposal {
  entries: MemoryEntryInput[]
  relationships: RelationshipInput[]
  beliefs: BeliefInput[]
}

export interface CharacterMemory {
  worldId: string
  characterId: string
  core: string
  currentState: string
  revision: number
  updatedAt: string | null
  entries: Array<{
    id: number
    kind: MemoryEntryKind
    eventId: number
    knowledgeId: number | null
    content: string
    importance: number
    createdAt: string
  }>
  relationships: Array<{ targetId: string; note: string; trust: number | null; updatedAt: string }>
  beliefs: Array<{
    id: number
    statement: string
    status: BeliefStatus
    confidence: number
    knowledgeId: number | null
    updatedAt: string
  }>
}

export type ApplyProposalResult =
  | { status: 'applied'; revision: number }
  | { status: 'duplicate'; revision: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new RuleError(`${field}: ожидается непустая строка до ${maxLength} символов`)
  }
  return value.trim()
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, field, maxLength)
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new RuleError(`${field}: целое число должно быть в диапазоне ${min}..${max}`)
  }
  return value as number
}

function optionalPositiveId(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  return boundedInteger(value, field, 1, Number.MAX_SAFE_INTEGER)
}

function parseList<T>(value: unknown, field: string, parser: (item: unknown, index: number) => T, maxItems = 20): T[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) throw new RuleError(`${field}: ожидается список не длиннее ${maxItems} элементов`)
  return value.map(parser)
}

export function normalizeProposal(input: unknown): NormalizedProposal {
  if (!isRecord(input)) throw new RuleError('proposal: ожидается объект')
  const worldId = requiredString(input.worldId, 'worldId', 100)
  const characterId = requiredString(input.characterId, 'characterId', 100)
  const proposalId = requiredString(input.proposalId, 'proposalId', 100)
  const expectedRevision = boundedInteger(input.expectedRevision, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER)
  const eventId = boundedInteger(input.eventId, 'eventId', 1, Number.MAX_SAFE_INTEGER)
  const reason = requiredString(input.reason, 'reason', 2000)
  const core = optionalString(input.core, 'core', 8000)
  const currentState = optionalString(input.currentState, 'currentState', 4000)
  const entries = parseList(input.entries, 'entries', (item, index): MemoryEntryInput => {
    if (!isRecord(item)) throw new RuleError(`entries[${index}]: ожидается объект`)
    if (item.kind !== 'recent' && item.kind !== 'significant') throw new RuleError(`entries[${index}].kind: недопустимое значение`)
    const knowledgeId = optionalPositiveId(item.knowledgeId, `entries[${index}].knowledgeId`)
    return {
      kind: item.kind,
      content: requiredString(item.content, `entries[${index}].content`, 4000),
      importance: boundedInteger(item.importance, `entries[${index}].importance`, 0, 100),
      ...(knowledgeId !== undefined ? { knowledgeId } : {}),
    }
  })
  const relationships = parseList(input.relationships, 'relationships', (item, index): RelationshipInput => {
    if (!isRecord(item)) throw new RuleError(`relationships[${index}]: ожидается объект`)
    const trust = item.trust === undefined ? undefined : item.trust === null ? null : boundedInteger(item.trust, `relationships[${index}].trust`, -100, 100)
    return {
      targetId: requiredString(item.targetId, `relationships[${index}].targetId`, 100),
      note: requiredString(item.note, `relationships[${index}].note`, 2000),
      ...(trust !== undefined ? { trust } : {}),
    }
  }, 33)
  const beliefs = parseList(input.beliefs, 'beliefs', (item, index): BeliefInput => {
    if (!isRecord(item)) throw new RuleError(`beliefs[${index}]: ожидается объект`)
    if (item.status !== 'believed' && item.status !== 'uncertain' && item.status !== 'rejected') {
      throw new RuleError(`beliefs[${index}].status: недопустимое значение`)
    }
    const knowledgeId = optionalPositiveId(item.knowledgeId, `beliefs[${index}].knowledgeId`)
    return {
      statement: requiredString(item.statement, `beliefs[${index}].statement`, 1000),
      status: item.status,
      confidence: boundedInteger(item.confidence, `beliefs[${index}].confidence`, 0, 100),
      ...(knowledgeId !== undefined ? { knowledgeId } : {}),
    }
  })
  if (core === undefined && currentState === undefined && entries.length === 0 && relationships.length === 0 && beliefs.length === 0) {
    throw new RuleError('proposal должен содержать хотя бы одно изменение')
  }
  return {
    worldId,
    characterId,
    proposalId,
    expectedRevision,
    eventId,
    reason,
    ...(core !== undefined ? { core } : {}),
    ...(currentState !== undefined ? { currentState } : {}),
    entries,
    relationships,
    beliefs,
  }
}

function proposalHash(proposal: NormalizedProposal): string {
  return createHash('sha256').update(JSON.stringify(proposal)).digest('hex')
}

function requireCharacter(db: DatabaseSync, worldId: string, characterId: string): void {
  const row = db.prepare('SELECT id FROM characters WHERE world_id = ? AND id = ?').get(worldId, characterId)
  if (!row) throw new RuleError(`персонаж ${characterId} не найден в мире ${worldId}`)
}

function requireEvent(db: DatabaseSync, worldId: string, eventId: number): void {
  const row = db.prepare('SELECT id FROM events WHERE world_id = ? AND id = ?').get(worldId, eventId)
  if (!row) throw new RuleError(`событие ${eventId} не найдено в мире ${worldId}`)
}

function requireKnowledge(db: DatabaseSync, worldId: string, characterId: string, knowledgeId: number, eventId: number): void {
  const linked = db.prepare(
    `SELECT k.id, k.fact_id, k.day AS knowledge_day, k.event_id AS knowledge_event_id
       FROM knowledge k
      WHERE k.id = ? AND k.world_id = ? AND k.character_id = ?`,
  ).get(knowledgeId, worldId, characterId) as {
    id: number; fact_id: number | null; knowledge_day: number; knowledge_event_id: number | null
  } | undefined
  if (!linked) throw new RuleError(`источник знания ${knowledgeId} не принадлежит персонажу или миру`)
  if (linked.knowledge_event_id !== eventId) {
    throw new RuleError(`источник знания ${knowledgeId} не относится к событию ${eventId}`)
  }
  if (linked.fact_id !== null) {
    const fact = db.prepare('SELECT id FROM facts WHERE id = ? AND world_id = ?').get(linked.fact_id, worldId)
    if (!fact) throw new RuleError(`факт источника знания ${knowledgeId} не принадлежит миру`)
  }
}

/** Read the current wiki-like memory. Missing memory is an empty revision-zero state. */
export function getCharacterMemory(db: DatabaseSync, worldId: string, characterId: string): CharacterMemory {
  requireCharacter(db, worldId, characterId)
  const head = db.prepare(
    'SELECT core, current_state, revision, updated_at FROM character_memory WHERE world_id = ? AND character_id = ?',
  ).get(worldId, characterId) as { core: string; current_state: string; revision: number; updated_at: string } | undefined
  const entries = db.prepare(
    'SELECT id, kind, event_id, knowledge_id, content, importance, created_at FROM memory_entries WHERE world_id = ? AND character_id = ? ORDER BY id',
  ).all(worldId, characterId) as unknown as Array<{
    id: number; kind: MemoryEntryKind; event_id: number; knowledge_id: number | null; content: string; importance: number; created_at: string
  }>
  const relationships = db.prepare(
    'SELECT target_id, note, trust, updated_at FROM memory_relationships WHERE world_id = ? AND character_id = ? ORDER BY target_id',
  ).all(worldId, characterId) as unknown as Array<{ target_id: string; note: string; trust: number | null; updated_at: string }>
  const beliefs = db.prepare(
    'SELECT id, statement, status, confidence, knowledge_id, updated_at FROM memory_beliefs WHERE world_id = ? AND character_id = ? ORDER BY id',
  ).all(worldId, characterId) as unknown as Array<{
    id: number; statement: string; status: BeliefStatus; confidence: number; knowledge_id: number | null; updated_at: string
  }>
  return {
    worldId,
    characterId,
    core: head?.core ?? '',
    currentState: head?.current_state ?? '',
    revision: head?.revision ?? 0,
    updatedAt: head?.updated_at ?? null,
    entries: entries.map((x) => ({ id: x.id, kind: x.kind, eventId: x.event_id, knowledgeId: x.knowledge_id, content: x.content, importance: x.importance, createdAt: x.created_at })),
    relationships: relationships.map((x) => ({ targetId: x.target_id, note: x.note, trust: x.trust, updatedAt: x.updated_at })),
    beliefs: beliefs.map((x) => ({ id: x.id, statement: x.statement, status: x.status, confidence: x.confidence, knowledgeId: x.knowledge_id, updatedAt: x.updated_at })),
  }
}

/** Validate and atomically apply one reflection proposal. Safe to retry by proposalId. */
export function applyReflectionProposal(db: DatabaseSync, input: unknown): ApplyProposalResult {
  const proposal = normalizeProposal(input)
  const hash = proposalHash(proposal)
  const now = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    requireCharacter(db, proposal.worldId, proposal.characterId)
    requireEvent(db, proposal.worldId, proposal.eventId)
    const duplicate = db.prepare(
      'SELECT payload_hash, resulting_revision FROM memory_proposals WHERE world_id = ? AND character_id = ? AND proposal_id = ?',
    ).get(proposal.worldId, proposal.characterId, proposal.proposalId) as { payload_hash: string; resulting_revision: number } | undefined
    if (duplicate) {
      if (duplicate.payload_hash !== hash) throw new RuleError('proposalId уже использован с другим содержимым')
      db.exec('COMMIT')
      return { status: 'duplicate', revision: duplicate.resulting_revision }
    }

    const current = db.prepare(
      'SELECT core, current_state, revision FROM character_memory WHERE world_id = ? AND character_id = ?',
    ).get(proposal.worldId, proposal.characterId) as { core: string; current_state: string; revision: number } | undefined
    const currentRevision = current?.revision ?? 0
    if (currentRevision !== proposal.expectedRevision) throw new RuleError(`устаревшая ревизия: ожидалась ${proposal.expectedRevision}, текущая ${currentRevision}`)

    for (const entry of proposal.entries) if (entry.knowledgeId !== undefined) requireKnowledge(db, proposal.worldId, proposal.characterId, entry.knowledgeId, proposal.eventId)
    for (const belief of proposal.beliefs) if (belief.knowledgeId !== undefined) requireKnowledge(db, proposal.worldId, proposal.characterId, belief.knowledgeId, proposal.eventId)

    const existing = db.prepare(
      'SELECT target_id FROM memory_relationships WHERE world_id = ? AND character_id = ?',
    ).all(proposal.worldId, proposal.characterId) as unknown as Array<{ target_id: string }>
    const targets = new Set(existing.map((x) => x.target_id))
    for (const relationship of proposal.relationships) targets.add(relationship.targetId)
    if (targets.size > 32) throw new RuleError('превышен лимит 32 профилей отношений')

    const revision = currentRevision + 1
    const core = proposal.core ?? current?.core ?? ''
    const currentState = proposal.currentState ?? current?.current_state ?? ''
    db.prepare(
      `INSERT INTO character_memory (world_id, character_id, core, current_state, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(world_id, character_id) DO UPDATE SET core=excluded.core, current_state=excluded.current_state, revision=excluded.revision, updated_at=excluded.updated_at`,
    ).run(proposal.worldId, proposal.characterId, core, currentState, revision, now)

    for (const entry of proposal.entries) {
      db.prepare('INSERT INTO memory_entries (world_id, character_id, kind, event_id, knowledge_id, content, importance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(proposal.worldId, proposal.characterId, entry.kind, proposal.eventId, entry.knowledgeId ?? null, entry.content, entry.importance, now)
    }
    for (const relationship of proposal.relationships) {
      db.prepare(
        `INSERT INTO memory_relationships (world_id, character_id, target_id, note, trust, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(world_id, character_id, target_id) DO UPDATE SET note=excluded.note, trust=excluded.trust, updated_at=excluded.updated_at`,
      ).run(proposal.worldId, proposal.characterId, relationship.targetId, relationship.note, relationship.trust ?? null, now)
    }
    for (const belief of proposal.beliefs) {
      db.prepare(
        `INSERT INTO memory_beliefs (world_id, character_id, statement, status, confidence, knowledge_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(world_id, character_id, statement) DO UPDATE SET status=excluded.status, confidence=excluded.confidence, knowledge_id=excluded.knowledge_id, updated_at=excluded.updated_at`,
      ).run(proposal.worldId, proposal.characterId, belief.statement, belief.status, belief.confidence, belief.knowledgeId ?? null, now)
    }

    db.prepare(
      `INSERT INTO memory_proposals (world_id, character_id, proposal_id, payload_hash, event_id, expected_revision, resulting_revision, reason, payload, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(proposal.worldId, proposal.characterId, proposal.proposalId, hash, proposal.eventId, proposal.expectedRevision, revision, proposal.reason, JSON.stringify(proposal), now)
    db.prepare(
      `INSERT INTO memory_revisions (world_id, character_id, revision, proposal_id, event_id, core, current_state, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(proposal.worldId, proposal.characterId, revision, proposal.proposalId, proposal.eventId, core, currentState, proposal.reason, now)

    db.exec('COMMIT')
    return { status: 'applied', revision }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Deterministic local adapter; deliberately does not call an LLM. */
export function createDeterministicReflectionAdapter(proposal: ReflectionProposal): (context: { eventId: number; revision: number }) => NormalizedProposal {
  const normalized = normalizeProposal(proposal)
  return ({ eventId, revision }) => ({ ...normalized, eventId, expectedRevision: revision })
}

export function exportCharacterMemoryMarkdown(memory: CharacterMemory, displayName: string): string {
  const lines = [
    `# Память: ${displayName}`,
    '',
    `Ревизия: ${memory.revision}`,
    '',
    '## Ядро',
    memory.core || '_Пока не сформировано._',
    '',
    '## Текущее состояние',
    memory.currentState || '_Не задано._',
    '',
    '## Недавний опыт',
    ...memory.entries.filter((x) => x.kind === 'recent').map((x) => `- [событие ${x.eventId}] ${x.content}`),
    '',
    '## Значимые воспоминания',
    ...memory.entries.filter((x) => x.kind === 'significant').map((x) => `- [событие ${x.eventId}; важность ${x.importance}] ${x.content}`),
    '',
    '## Отношения',
    ...memory.relationships.map((x) => `- ${x.targetId}${x.trust === null ? '' : ` (доверие ${x.trust})`}: ${x.note}`),
    '',
    '## Убеждения',
    ...memory.beliefs.map((x) => `- ${x.status}, уверенность ${x.confidence}%${x.knowledgeId === null ? '' : ` [знание ${x.knowledgeId}]`}: ${x.statement}`),
    '',
  ]
  return lines.join('\n')
}
