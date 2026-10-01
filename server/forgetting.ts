import type { DatabaseSync } from 'node:sqlite'

/**
 * Механика забывания и консолидации памяти (этап 7) + переиспользуемые шаги
 * для смысловой консолидации моделью (приоритет этапа 9).
 * Трогает только эпизодические записи (`memory_entries`) и профили отношений;
 * никогда не удаляет выводы — убеждения, защищённые отношения, ядро.
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

/** Скользящее окно recent: старые малозначимые вытесняются, значимые повышаются. */
export function consolidateRecent(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
  budgets: MemoryBudgets = DEFAULT_BUDGETS,
): { evictedRecent: number; promotedRecent: number } {
  const result = { evictedRecent: 0, promotedRecent: 0 }
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

  return result
}

export interface SignificantEntry {
  id: number
  event_id: number
  content: string
  importance: number
}

/** Возвращает записи, подлежащие сжатию при переполнении significant; null, если в рамках бюджета. */
export function getSignificantOverflow(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
  max: number,
): SignificantEntry[] | null {
  const significant = db
    .prepare(
      "SELECT id, event_id, content, importance FROM memory_entries WHERE world_id = ? AND character_id = ? AND kind = 'significant' ORDER BY importance ASC, id ASC",
    )
    .all(worldId, characterId) as unknown as SignificantEntry[]

  if (significant.length <= max) return null
  const overflow = significant.length - max
  return significant.slice(0, overflow + 1)
}

/** Удаляет переданные записи и добавляет одну обобщающую (с указанным содержанием). */
export function mergeSignificantEntries(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
  entries: SignificantEntry[],
  summaryContent: string,
): void {
  const ids = entries.map((e) => e.id)
  const oldestEventId = Math.min(...entries.map((e) => e.event_id))
  const maxImportance = Math.max(...entries.map((e) => e.importance))
  const placeholders = ids.map(() => '?').join(',')

  db.prepare(`DELETE FROM memory_entries WHERE id IN (${placeholders})`).run(...ids)
  db.prepare(
    `INSERT INTO memory_entries (world_id, character_id, kind, event_id, knowledge_id, content, importance, created_at)
     VALUES (?, ?, 'significant', ?, NULL, ?, ?, ?)`,
  ).run(worldId, characterId, oldestEventId, summaryContent, maxImportance, new Date().toISOString())
}

function templateSummary(entries: SignificantEntry[]): string {
  const excerpt = entries.map((e) => (e.content ?? '').slice(0, 30)).join(' | ')
  return `Обобщение ${entries.length} эпизодов: ${excerpt}`
}

export function consolidateSignificant(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
  budgets: MemoryBudgets = DEFAULT_BUDGETS,
): { mergedSignificant: number } {
  const overflow = getSignificantOverflow(db, worldId, characterId, budgets.maxSignificant)
  if (!overflow) return { mergedSignificant: 0 }
  mergeSignificantEntries(db, worldId, characterId, overflow, templateSummary(overflow))
  return { mergedSignificant: overflow.length }
}

/** Механическая консолидация (без LLM): окно recent + шаблонное сжатие significant. */
export function consolidateMemory(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
  budgets: MemoryBudgets = DEFAULT_BUDGETS,
): ConsolidationResult {
  const recent = consolidateRecent(db, worldId, characterId, budgets)
  const significant = consolidateSignificant(db, worldId, characterId, budgets)
  return {
    evictedRecent: recent.evictedRecent,
    promotedRecent: recent.promotedRecent,
    mergedSignificant: significant.mergedSignificant,
  }
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
