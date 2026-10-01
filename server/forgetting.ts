import type { DatabaseSync } from 'node:sqlite'

/**
 * Механика забывания и консолидации памяти (этап 7).
 * Детерминированная, без LLM. Трогает только эпизодические записи (`memory_entries`)
 * и профили отношений (`memory_relationships`); никогда не удаляет выводы —
 * убеждения (`memory_beliefs`), отношения с незавершёнными обязательствами, ядро.
 */

export interface MemoryBudgets {
  maxRecent: number
  maxSignificant: number
  maxRelationships: number
  promoteThreshold: number // importance >= порог → повысить recent в significant
}

export const DEFAULT_BUDGETS: MemoryBudgets = {
  maxRecent: 20,
  maxSignificant: 30,
  maxRelationships: 32,
  promoteThreshold: 60,
}

export interface ConsolidationResult {
  evictedRecent: number
  promotedRecent: number
  mergedSignificant: number
}

/** Приводит память к бюджетам: скользящее окно recent + сжатие significant. */
export function consolidateMemory(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
  budgets: MemoryBudgets = DEFAULT_BUDGETS,
): ConsolidationResult {
  const result = { evictedRecent: 0, promotedRecent: 0, mergedSignificant: 0 }

  // 1. recent — скользящее окно: старые малозначимые вытесняются, значимые повышаются.
  const recent = db
    .prepare(
      "SELECT id, importance FROM memory_entries WHERE world_id = ? AND character_id = ? AND kind = 'recent' ORDER BY id",
    )
    .all(worldId, characterId) as unknown as Array<{ id: number; importance: number }>

  if (recent.length > budgets.maxRecent) {
    const excess = recent.slice(0, recent.length - budgets.maxRecent)
    for (const entry of excess) {
      if (entry.importance >= budgets.promoteThreshold) {
        db.prepare("UPDATE memory_entries SET kind = 'significant' WHERE id = ?").run(entry.id)
        result.promotedRecent++
      } else {
        db.prepare('DELETE FROM memory_entries WHERE id = ?').run(entry.id)
        result.evictedRecent++
      }
    }
  }

  // 2. significant — переполнение сжимается в один общий вывод.
  const significant = db
    .prepare(
      "SELECT id, event_id, content, importance FROM memory_entries WHERE world_id = ? AND character_id = ? AND kind = 'significant' ORDER BY importance ASC, id ASC",
    )
    .all(worldId, characterId) as unknown as Array<{
    id: number
    event_id: number
    content: string
    importance: number
  }>

  if (significant.length > budgets.maxSignificant) {
    const overflow = significant.length - budgets.maxSignificant
    const toMerge = significant.slice(0, overflow + 1)
    const ids = toMerge.map((e) => e.id)
    const oldestEventId = Math.min(...toMerge.map((e) => e.event_id))
    const maxImportance = Math.max(...toMerge.map((e) => e.importance))
    const excerpt = toMerge.map((e) => (e.content ?? '').slice(0, 30)).join(' | ')
    const placeholders = ids.map(() => '?').join(',')

    db.prepare(`DELETE FROM memory_entries WHERE id IN (${placeholders})`).run(...ids)
    db.prepare(
      `INSERT INTO memory_entries (world_id, character_id, kind, event_id, knowledge_id, content, importance, created_at)
       VALUES (?, ?, 'significant', ?, NULL, ?, ?, ?)`,
    ).run(
      worldId,
      characterId,
      oldestEventId,
      `Обобщение ${toMerge.length} эпизодов: ${excerpt}`,
      maxImportance,
      new Date().toISOString(),
    )
    result.mergedSignificant = toMerge.length
  }

  return result
}

export interface RelationshipEvictionResult {
  evicted: number
  protectedCount: number
}

/** Цели отношений, которые нельзя вытеснять: есть незавершённое обязательство к этому получателю. */
function protectedTargets(db: DatabaseSync, worldId: string, characterId: string): Set<string> {
  const rows = db
    .prepare("SELECT recipient FROM obligations WHERE world_id = ? AND character_id = ? AND status = 'pending'")
    .all(worldId, characterId) as unknown as Array<{ recipient: string }>
  return new Set(rows.map((r) => r.recipient))
}

/** Вытесняет наименее «защищённые» отношения сверх лимита, сохраняя краткий след каждого. */
export function evictRelationships(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
  max: number = DEFAULT_BUDGETS.maxRelationships,
): RelationshipEvictionResult {
  const relationships = db
    .prepare(
      'SELECT target_id, note, trust FROM memory_relationships WHERE world_id = ? AND character_id = ? ORDER BY (trust IS NULL) ASC, target_id ASC',
    )
    .all(worldId, characterId) as unknown as Array<{ target_id: string; note: string; trust: number | null }>

  if (relationships.length <= max) return { evicted: 0, protectedCount: 0 }

  const protectedSet = protectedTargets(db, worldId, characterId)
  let evicted = 0
  let protectedCount = 0

  for (const rel of relationships) {
    if (relationships.length - evicted <= max) break
    if (protectedSet.has(rel.target_id)) {
      protectedCount++
      continue
    }
    db.prepare(
      'INSERT INTO relationship_traces (world_id, character_id, target_id, note, evicted_at) VALUES (?, ?, ?, ?, ?)',
    ).run(worldId, characterId, rel.target_id, rel.note, new Date().toISOString())
    db.prepare('DELETE FROM memory_relationships WHERE world_id = ? AND character_id = ? AND target_id = ?').run(
      worldId,
      characterId,
      rel.target_id,
    )
    evicted++
  }

  return { evicted, protectedCount }
}
