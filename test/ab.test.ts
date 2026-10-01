import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { runABComparison } from '../server/ab'

const enabled = process.env.RUN_LLM_TESTS === '1'

test('A/B: рефлексивный vs статический персонаж (реальный API)', { skip: !enabled }, async () => {
  const db = openDb(':memory:')
  const result = await runABComparison(db)

  // механическая разница: рефлексивный накопил опыт, статический — нет
  assert.ok(result.reflective.revision > result.static.revision)
  assert.ok(result.reflective.beliefs.length > 0)
  assert.equal(result.static.beliefs.length, 0)

  // обе реплики непустые; качественную разницу оценивает человек
  assert.ok(result.reflective.reply.length > 0)
  assert.ok(result.static.reply.length > 0)

  // вывод для человеческой оценки
  console.log('\n===== A/B-сравнение (этап 9, приоритет 3) =====')
  console.log(`Вопрос: ${result.question}`)
  console.log(`\nРефлексивный (${result.reflective.characterId}, ревизия ${result.reflective.revision}):`)
  console.log(`  ${result.reflective.reply}`)
  console.log(`  Убеждения: ${result.reflective.beliefs.join('; ') || '—'}`)
  console.log(`\nСтатический (${result.static.characterId}, ревизия ${result.static.revision}):`)
  console.log(`  ${result.static.reply}`)
  console.log('===================================================\n')
})
