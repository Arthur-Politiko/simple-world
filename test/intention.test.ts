import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld } from '../server/world'
import { applyIntention, getDecisionChain, seedCharacterCore } from '../server/agent'

test('applyIntention: невозможное перемещение отклоняется, не выполняясь', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  const r = applyIntention(db, id, 'chr-marta', { action: 'move', targetId: 'loc-nope', reason: 'тест' })
  assert.equal(r.outcome, 'rejected')
  assert.match(r.error ?? '', /локация не найдена/)
  assert.equal(r.state, null, 'состояние не меняется при отклонении')
})

test('applyIntention: расход сверх запаса отклоняется', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  const r = applyIntention(db, id, 'chr-marta', { action: 'consume', resource: 'зерно', amount: 99999, reason: 'тест' })
  assert.equal(r.outcome, 'rejected')
  assert.match(r.error ?? '', /недостаточно/)
})

test('applyIntention: валидное перемещение выполняется', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  const r = applyIntention(db, id, 'chr-marta', { action: 'move', targetId: 'loc-forest', reason: 'за дровами' })
  assert.equal(r.outcome, 'executed')
  assert.equal(r.state?.characters.find((c) => c.id === 'chr-marta')?.location_id, 'loc-forest')
})

test('getDecisionChain возвращает цепочку событий, памяти и решений', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  seedCharacterCore(db, id, 'chr-marta', 'ядро для теста')
  applyIntention(db, id, 'chr-marta', { action: 'rest', reason: 'отдых' })

  const chain = getDecisionChain(db, id, 'chr-marta')
  assert.equal(chain.character.core, 'ядро для теста')
  assert.ok(chain.decisions.length >= 1)
  assert.equal(chain.decisions[0].action, 'rest')
})
