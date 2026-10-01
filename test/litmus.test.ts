import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'
import { applyReflectionProposal, getCharacterMemory } from '../server/memory'
import { applyIntention, getDecisionChain, reflectOnEvent } from '../server/agent'

// Litmus-тест (D-018): «прожитое влияет на решения».
// Цепочка: событие → память → решение. Детерминированная версия без LLM.

test('litmus: событие → память → решение (детерминированно)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  // 1. дожить до жатвы (осень, день 15)
  runDays(db, id, 15)
  const st = getWorldState(db, id)
  const harvest = st.events.find((e) => e.type === 'harvest')
  assert.ok(harvest, 'событие жатвы есть')

  // 2. рефлексия: событие → убеждение (детерминированное предложение)
  const applied = applyReflectionProposal(db, {
    worldId: id,
    characterId: 'chr-marta',
    proposalId: 'litmus-reflect-1',
    expectedRevision: 0,
    eventId: harvest.id,
    reason: 'жатва прошла — двор с зерном',
    beliefs: [{ statement: 'жатва — опора двора', status: 'believed', confidence: 85 }],
  })

  // 3. память изменилась: ревизия выросла, убеждение появилось
  const mem = getCharacterMemory(db, id, 'chr-marta')
  assert.equal(mem.revision, applied.revision)
  assert.ok(mem.beliefs.some((b) => b.statement === 'жатва — опора двора'))

  // 4. решение после рефлексии несёт новую ревизию памяти
  const decision = applyIntention(db, id, 'chr-marta', { action: 'rest', reason: 'отдых после жатвы' })
  assert.equal(decision.outcome, 'executed')

  // 5. цепочка связывает событие → знание → память → решение
  const chain = getDecisionChain(db, id, 'chr-marta')
  assert.equal(chain.character.revision, applied.revision)
  assert.ok(chain.beliefs.some((b) => b.statement === 'жатва — опора двора'))
  assert.ok(chain.decisions.some((d) => d.memoryRevision === applied.revision), 'решение сделано с новой памятью')
})

// Полная версия с реальным LLM: неурожай → рефлексия → след в памяти.
test('litmus (LLM): неурожай оставляет след в памяти', { skip: !process.env.RUN_LLM_TESTS }, async () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  // неурожай: нет зерна на посев
  db.prepare("DELETE FROM stock WHERE holder_type = 'character' AND resource = 'зерно'").run()
  db.prepare("UPDATE plots SET sown = 0, harvest = 0 WHERE kind = 'поле'").run()
  runDays(db, id, 20)
  const st = getWorldState(db, id)
  const failed = st.events.find((e) => e.type === 'harvest_failed')
  assert.ok(failed, 'жатва провалена')

  // рефлексия реальным LLM
  const outcome = await reflectOnEvent(db, id, 'chr-marta', failed.id)
  assert.ok(outcome.revision >= 1, 'память изменилась')

  const hasTrace =
    outcome.memory.beliefs.length > 0 || outcome.memory.entries.some((e) => e.eventId === failed.id)
  assert.ok(hasTrace, 'неурожай оставил след в памяти')
})
