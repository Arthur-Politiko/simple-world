import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'
import {
  applyReflectionProposal,
  createDeterministicReflectionAdapter,
  exportCharacterMemoryMarkdown,
  getCharacterMemory,
  type ReflectionProposal,
} from '../server/memory'

function setup() {
  const db = openDb(':memory:')
  const world = createWorld(db, 'Память', 11)
  const eventId = world.events.find((event) => event.type === 'world_created')!.id
  return { db, worldId: world.world.id, eventId }
}

test('новое wiki-состояние пустое, версия памяти равна нулю', () => {
  const { db, worldId } = setup()
  const memory = getCharacterMemory(db, worldId, 'chr-marta')
  assert.equal(memory.revision, 0)
  assert.equal(memory.core, '')
  assert.equal(memory.entries.length, 0)
  assert.equal(memory.relationships.length, 0)
  assert.equal(memory.beliefs.length, 0)
})

test('предложение рефлексии атомарно сохраняет ядро, память, отношение и убеждение', () => {
  const { db, worldId, eventId } = setup()
  const proposal: ReflectionProposal = {
    worldId,
    characterId: 'chr-marta',
    proposalId: 'reflection-1',
    expectedRevision: 0,
    eventId,
    reason: 'Поступок противоречит прежнему ожиданию корысти.',
    core: 'Помощь незнакомца может быть искренней, но доверие нужно заслужить.',
    currentState: 'Осторожно благодарна.',
    entries: [{ kind: 'significant', content: 'Игрок помог без требования оплаты.', importance: 72 }],
    relationships: [{ targetId: 'player-1', note: 'Помог без очевидной выгоды; доверие осторожно растёт.', trust: 15 }],
    beliefs: [{ statement: 'Не всякая помощь незнакомца корыстна.', status: 'uncertain', confidence: 55 }],
  }
  const adapter = createDeterministicReflectionAdapter(proposal)
  const result = applyReflectionProposal(db, adapter({ eventId, revision: 0 }))
  assert.deepEqual(result, { status: 'applied', revision: 1 })

  const memory = getCharacterMemory(db, worldId, 'chr-marta')
  assert.equal(memory.core, proposal.core)
  assert.equal(memory.currentState, proposal.currentState)
  assert.equal(memory.entries.length, 1)
  assert.equal(memory.entries[0].eventId, eventId)
  assert.equal(memory.relationships[0].trust, 15)
  assert.equal(memory.beliefs[0].status, 'uncertain')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_revisions').get()?.n, 1)

  const markdown = exportCharacterMemoryMarkdown(memory, 'Марта')
  assert.match(markdown, /## Ядро/)
  assert.match(markdown, /## Значимые воспоминания/)
  assert.match(markdown, /player-1/)
})

test('повторный proposalId с тем же payload идемпотентен; с другим payload отклоняется', () => {
  const { db, worldId, eventId } = setup()
  const proposal = {
    worldId,
    characterId: 'chr-marta',
    proposalId: 'same-id',
    expectedRevision: 0,
    eventId,
    reason: 'Запомнить встречу.',
    entries: [{ kind: 'recent', content: 'Встретила путника.', importance: 10 }],
  }
  assert.deepEqual(applyReflectionProposal(db, proposal), { status: 'applied', revision: 1 })
  assert.deepEqual(applyReflectionProposal(db, proposal), { status: 'duplicate', revision: 1 })
  assert.equal(getCharacterMemory(db, worldId, 'chr-marta').entries.length, 1)
  assert.throws(() => applyReflectionProposal(db, { ...proposal, reason: 'Изменённый payload.' }), /proposalId уже использован/)
})

test('устаревшая ревизия отклоняется без частичных изменений', () => {
  const { db, worldId, eventId } = setup()
  const base = { worldId, characterId: 'chr-marta', expectedRevision: 0, eventId, reason: 'Событие.' }
  applyReflectionProposal(db, { ...base, proposalId: 'first', currentState: 'Удивлена.' })
  assert.throws(
    () => applyReflectionProposal(db, {
      ...base,
      proposalId: 'stale',
      expectedRevision: 0,
      core: 'Это не должно сохраниться.',
      entries: [{ kind: 'significant', content: 'Не добавлять.', importance: 80 }],
    }),
    /устаревшая ревизия/,
  )
  const memory = getCharacterMemory(db, worldId, 'chr-marta')
  assert.equal(memory.revision, 1)
  assert.equal(memory.core, '')
  assert.equal(memory.entries.length, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_proposals').get()?.n, 1)
})

test('отклоняются неизвестные события, источники знания и значения вне диапазона', () => {
  const { db, worldId, eventId } = setup()
  const base = { worldId, characterId: 'chr-marta', expectedRevision: 0, eventId, reason: 'Проверка входа.' }
  assert.throws(() => applyReflectionProposal(db, { ...base, proposalId: 'bad-event', eventId: 999, core: 'X' }), /событие 999 не найдено/)
  assert.throws(() => applyReflectionProposal(db, {
    ...base,
    proposalId: 'bad-knowledge',
    entries: [{ kind: 'recent', content: 'С опорой на несуществующий слух.', importance: 5, knowledgeId: 999 }],
  }), /источник знания/)
  assert.throws(() => applyReflectionProposal(db, {
    ...base,
    proposalId: 'bad-trust',
    relationships: [{ targetId: 'player-1', note: 'Вне диапазона.', trust: 101 }],
  }), /trust: целое число/)
  assert.equal(getCharacterMemory(db, worldId, 'chr-marta').revision, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_proposals').get()?.n, 0)
})

test('лимит 32 профилей отношений проверяется атомарно', () => {
  const { db, worldId, eventId } = setup()
  const relationships = Array.from({ length: 33 }, (_, i) => ({ targetId: `person-${i}`, note: `Знакомый ${i}.`, trust: 0 }))
  assert.throws(
    () => applyReflectionProposal(db, {
      worldId,
      characterId: 'chr-marta',
      proposalId: 'too-many-people',
      expectedRevision: 0,
      eventId,
      reason: 'Проверить жёсткий лимит.',
      core: 'Не должно сохраниться при отказе.',
      relationships,
    }),
    /превышен лимит 32/,
  )
  const memory = getCharacterMemory(db, worldId, 'chr-marta')
  assert.equal(memory.revision, 0)
  assert.equal(memory.relationships.length, 0)
})

test('ложный слух можно сохранить как убеждение без превращения в факт', () => {
  const { db, worldId } = setup()
  const afterRumor = runDays(db, worldId, 8)
  const rumor = afterRumor.knowledge.find((row) => row.character_id === 'chr-tomek' && row.is_true === false)
  assert.ok(rumor)
  const rumorEvent = afterRumor.events.find((event) => event.type === 'news' && JSON.stringify(event.payload).includes('отменит оброк'))
  assert.ok(rumorEvent)
  assert.equal(rumor.event_id, rumorEvent.id)
  const adapter = createDeterministicReflectionAdapter({
    worldId,
    characterId: 'chr-tomek',
    proposalId: 'rumor-reflection',
    expectedRevision: 0,
    eventId: rumorEvent.id,
    reason: 'Трактирщик услышал, но пока не знает, правдив ли слух.',
    beliefs: [{ statement: 'Сеньор может отменить оброк.', status: 'uncertain', confidence: 25, knowledgeId: rumor.id }],
  })
  applyReflectionProposal(db, adapter({ eventId: rumorEvent.id, revision: 0 }))
  const memory = getCharacterMemory(db, worldId, 'chr-tomek')
  assert.equal(memory.beliefs[0].knowledgeId, rumor.id)
  assert.equal(memory.beliefs[0].status, 'uncertain')
  assert.equal(getWorldState(db, worldId).facts.some((fact) => fact.type.includes('оброк') && fact.type.includes('отмен')), false)
})
