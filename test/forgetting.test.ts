import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld } from '../server/world'
import { seedCharacterCore } from '../server/agent'
import { applyReflectionProposal } from '../server/memory'
import { consolidateMemory, evictRelationships, DEFAULT_BUDGETS } from '../server/forgetting'

function insertEntry(
  db: ReturnType<typeof openDb>,
  worldId: string,
  characterId: string,
  kind: string,
  eventId: number,
  content: string,
  importance: number,
): void {
  db.prepare(
    'INSERT INTO memory_entries (world_id, character_id, kind, event_id, knowledge_id, content, importance, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
  ).run(worldId, characterId, kind, eventId, content, importance, new Date().toISOString())
}

function countEntries(db: ReturnType<typeof openDb>, worldId: string, characterId: string, kind: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM memory_entries WHERE world_id = ? AND character_id = ? AND kind = ?')
    .get(worldId, characterId, kind) as { c: number }
  return row.c
}

function setup() {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  const eventId = s.events.find((e) => e.type === 'world_created')!.id
  seedCharacterCore(db, id, 'chr-marta', 'ядро')
  return { db, id, eventId }
}

test('recent: старые малозначимые вытесняются, значимые повышаются', () => {
  const { db, id, eventId } = setup()
  for (let i = 0; i < 25; i++) {
    insertEntry(db, id, 'chr-marta', 'recent', eventId, `запись ${i}`, i < 5 ? 90 : 10)
  }

  const result = consolidateMemory(db, id, 'chr-marta', { ...DEFAULT_BUDGETS, maxRecent: 10 })

  assert.equal(result.promotedRecent, 5)
  assert.equal(result.evictedRecent, 10)
  assert.equal(countEntries(db, id, 'chr-marta', 'recent'), 10)
  assert.equal(countEntries(db, id, 'chr-marta', 'significant'), 5)
})

test('significant: переполнение сжимается в общий вывод', () => {
  const { db, id, eventId } = setup()
  for (let i = 0; i < 35; i++) {
    insertEntry(db, id, 'chr-marta', 'significant', eventId, `эпизод ${i}`, 50)
  }

  const result = consolidateMemory(db, id, 'chr-marta', { ...DEFAULT_BUDGETS, maxSignificant: 30 })

  assert.equal(result.mergedSignificant, 6)
  assert.equal(countEntries(db, id, 'chr-marta', 'significant'), 30)
  const summary = db
    .prepare("SELECT content FROM memory_entries WHERE world_id = ? AND character_id = ? AND content LIKE 'Обобщение%'")
    .get(id, 'chr-marta') as { content: string } | undefined
  assert.ok(summary, 'должна появиться обобщающая запись')
})

test('выводы (убеждения и отношения) сохраняются при забывании деталей', () => {
  const { db, id, eventId } = setup()
  db.prepare(
    'INSERT INTO memory_beliefs (world_id, character_id, statement, status, confidence, knowledge_id, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
  ).run(id, 'chr-marta', 'торговец держит слово', 'believed', 80, new Date().toISOString())
  db.prepare(
    'INSERT INTO memory_relationships (world_id, character_id, target_id, note, trust, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, 'chr-marta', 'торговец', 'держит слово', 70, new Date().toISOString())

  for (let i = 0; i < 30; i++) insertEntry(db, id, 'chr-marta', 'recent', eventId, `встреча с торговцем ${i}`, 10)
  consolidateMemory(db, id, 'chr-marta', { ...DEFAULT_BUDGETS, maxRecent: 5 })

  const beliefs = db.prepare('SELECT COUNT(*) AS c FROM memory_beliefs WHERE world_id = ? AND character_id = ?').get(id, 'chr-marta') as { c: number }
  const rels = db.prepare('SELECT COUNT(*) AS c FROM memory_relationships WHERE world_id = ? AND character_id = ?').get(id, 'chr-marta') as { c: number }
  assert.equal(beliefs.c, 1, 'убеждение должно сохраниться')
  assert.equal(rels.c, 1, 'отношение должно сохраниться')
})

test('лимит знакомых: вытеснение с краткими следами и защитой', () => {
  const { db, id } = setup()
  db.prepare(
    'INSERT INTO obligations (world_id, character_id, recipient, resource, amount, due_day) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, 'chr-marta', 'сеньор', 'зерно', 10, 99)

  for (let i = 0; i < 40; i++) {
    db.prepare(
      'INSERT INTO memory_relationships (world_id, character_id, target_id, note, trust, updated_at) VALUES (?, ?, ?, ?, NULL, ?)',
    ).run(id, 'chr-marta', `знакомый-${i}`, `заметка ${i}`, new Date().toISOString())
  }
  db.prepare(
    'INSERT INTO memory_relationships (world_id, character_id, target_id, note, trust, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, 'chr-marta', 'сеньор', 'обязан', 60, new Date().toISOString())

  const result = evictRelationships(db, id, 'chr-marta', 32)

  assert.equal(result.evicted, 9)
  const relCount = db.prepare('SELECT COUNT(*) AS c FROM memory_relationships WHERE world_id = ? AND character_id = ?').get(id, 'chr-marta') as { c: number }
  assert.equal(relCount.c, 32)
  assert.ok(db.prepare('SELECT 1 AS x FROM memory_relationships WHERE world_id = ? AND character_id = ? AND target_id = ?').get(id, 'chr-marta', 'сеньор'), 'защищённое отношение осталось')
  const traces = db.prepare('SELECT COUNT(*) AS c FROM relationship_traces WHERE world_id = ? AND character_id = ?').get(id, 'chr-marta') as { c: number }
  assert.equal(traces.c, result.evicted, 'каждое вытеснение оставило краткий след')
})

test('обязательства не теряются при забывании', () => {
  const { db, id, eventId } = setup()
  const before = db.prepare('SELECT COUNT(*) AS c FROM obligations WHERE world_id = ?').get(id) as { c: number }
  for (let i = 0; i < 30; i++) insertEntry(db, id, 'chr-marta', 'recent', eventId, `событие ${i}`, 10)
  consolidateMemory(db, id, 'chr-marta', { ...DEFAULT_BUDGETS, maxRecent: 5 })
  const after = db.prepare('SELECT COUNT(*) AS c FROM obligations WHERE world_id = ?').get(id) as { c: number }
  assert.equal(after.c, before.c)
})

test('правка ядра имеет объяснение и предыдущую версию', () => {
  const { db, id, eventId } = setup()
  const result = applyReflectionProposal(db, {
    worldId: id,
    characterId: 'chr-marta',
    proposalId: 'test-core-1',
    expectedRevision: 1,
    eventId,
    reason: 'переосмыслил после слуха',
    core: 'новое ядро',
  })
  assert.equal(result.status, 'applied')

  const revisions = db
    .prepare('SELECT revision, core, reason FROM memory_revisions WHERE world_id = ? AND character_id = ? ORDER BY revision')
    .all(id, 'chr-marta') as unknown as Array<{ revision: number; core: string; reason: string }>
  assert.equal(revisions.length, 2)
  assert.equal(revisions[0].revision, 1)
  assert.equal(revisions[1].revision, 2)
  assert.equal(revisions[1].core, 'новое ядро')
  assert.equal(revisions[1].reason, 'переосмыслил после слуха')
})

test('консолидация не превращает предположение в факт', () => {
  const { db, id, eventId } = setup()
  const knowledgeRes = db
    .prepare("INSERT INTO knowledge (world_id, character_id, source, summary, fact_id, is_true, day) VALUES (?, ?, 'путник', ?, NULL, 0, 9)")
    .run(id, 'chr-marta', 'сеньор отменит оброк')
  const knowledgeId = Number(knowledgeRes.lastInsertRowid)

  for (let i = 0; i < 3; i++) insertEntry(db, id, 'chr-marta', 'significant', eventId, `слух ${i}`, 70)
  consolidateMemory(db, id, 'chr-marta', { ...DEFAULT_BUDGETS, maxSignificant: 1 })

  const k = db.prepare('SELECT is_true FROM knowledge WHERE id = ?').get(knowledgeId) as { is_true: number }
  assert.equal(k.is_true, 0, 'слух остался ложным знанием')
  const facts = db.prepare('SELECT COUNT(*) AS c FROM facts WHERE world_id = ?').get(id) as { c: number }
  assert.equal(facts.c, 0, 'консолидация не создала факт')
})
