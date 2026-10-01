import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld } from '../server/world'
import { getDecisionChain, seedCharacterCore } from '../server/agent'
import { runDaysWithAutonomy, significantCharacters } from '../server/autonomous'

const enabled = process.env.RUN_LLM_TESTS === '1'

test('significantCharacters: голодный персонаж — в значимом узле', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  db.prepare("DELETE FROM stock WHERE holder_type = 'character' AND holder_id = 'chr-grzegorz' AND resource IN ('зерно', 'рыба')").run()

  const ids = significantCharacters(db, id).map((c) => c.id)
  assert.ok(ids.includes('chr-grzegorz'), 'голодный персонаж должен быть значимым')
})

test('автономный выбор записывает решения (реальный API)', { skip: !enabled }, async () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  seedCharacterCore(db, id, 'chr-grzegorz', 'лесоруб, нуждается в еде')
  db.prepare("DELETE FROM stock WHERE holder_type = 'character' AND holder_id = 'chr-grzegorz' AND resource IN ('зерно', 'рыба')").run()

  const result = await runDaysWithAutonomy(db, id, 2, 1)
  assert.ok(result.decisions.length >= 1, 'должно быть хотя бы одно автономное решение')
  assert.ok(result.state.world.day >= 3)
  assert.ok(getDecisionChain(db, id, 'chr-grzegorz').decisions.length >= 1)
})
