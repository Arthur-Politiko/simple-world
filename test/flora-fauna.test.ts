import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

test('флора ограничивает фауну (кормовая база)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  // почти уничтожить кустарник — зайцу негде жить
  db.prepare("UPDATE flora SET density = 0.05 WHERE world_id = ? AND kind = 'кустарник'").run(id)
  runDays(db, id, 28)

  const st = getWorldState(db, id)
  const zayac = st.fauna.find((f) => f.kind === 'заяц')!.count
  assert.ok(zayac < 10, `заяц ограничен оскудевшим кустарником: ${zayac}`)
})

test('травоядные стравливают флору (перевыпас)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  const before = s.flora.find((f) => f.kind === 'кустарник')!.density

  // перевыпас: много зайцев и тетеревов
  db.prepare("UPDATE fauna SET count = 60 WHERE world_id = ? AND kind = 'заяц'").run(id)
  db.prepare("UPDATE fauna SET count = 30 WHERE world_id = ? AND kind = 'тетерев'").run(id)
  runDays(db, id, 28)

  const st = getWorldState(db, id)
  const after = st.flora.find((f) => f.kind === 'кустарник')!.density
  assert.ok(after < before, `кустарник оскудел от перевыпаса: ${before} → ${after}`)
})
