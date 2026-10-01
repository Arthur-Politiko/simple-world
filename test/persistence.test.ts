import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db'
import { advancePhase, createWorld, getWorldState } from '../server/world'

test('перезапуск сохраняет мир', () => {
  const dir = mkdtempSync(join(tmpdir(), 'village-'))
  const dbPath = join(dir, 'test.db')
  try {
    let db = openDb(dbPath)
    const s = createWorld(db, 'Тест', 9)
    const id = s.world.id
    advancePhase(db, id)
    const stockBefore = getWorldState(db, id).stock
    db.close()

    // «перезапуск» приложения
    db = openDb(dbPath)
    const restored = getWorldState(db, id)
    assert.equal(restored.world.day, 1)
    assert.equal(restored.phaseName, 'день')
    assert.deepEqual(restored.stock, stockBefore)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
