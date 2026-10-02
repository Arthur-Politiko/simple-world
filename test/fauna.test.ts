import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, gather, getWorldState, runDays } from '../server/world'

test('фауна-популяции есть (заяц/тетерев/кабан/лиса)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  assert.ok(s.fauna.some((f) => f.kind === 'заяц'), 'заяц есть')
  assert.ok(s.fauna.some((f) => f.kind === 'тетерев'), 'тетерев есть')
  assert.ok(s.fauna.some((f) => f.kind === 'кабан'), 'кабан есть')
  assert.ok(s.fauna.some((f) => f.kind === 'лиса'), 'лиса есть')
})

test('охота истощает дичь (популяции фауны)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  const before = s.fauna.filter((f) => ['заяц', 'тетерев', 'кабан'].includes(f.kind)).reduce((sum, f) => sum + f.count, 0)

  const st = gather(db, id, 'chr-marta', 'дичь', 5)
  const after = st.fauna.filter((f) => ['заяц', 'тетерев', 'кабан'].includes(f.kind)).reduce((sum, f) => sum + f.count, 0)
  assert.equal(after, before - 5, 'дичь убавилась на собранное')
})

test('фауна размножается и несёт потери по сезонам', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  const before = s.fauna.find((f) => f.kind === 'заяц')!.count
  runDays(db, id, 28) // полный год (весна размножение + зима потери)
  const st = getWorldState(db, id)
  const after = st.fauna.find((f) => f.kind === 'заяц')!.count
  assert.notEqual(after, before, 'численность зайца изменилась за год')
})
