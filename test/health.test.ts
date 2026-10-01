import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { buildApp } from '../server/app'

test('GET /api/health возвращает ok', async () => {
  const db = openDb(':memory:')
  const app = buildApp(db)
  const res = await app.inject({ method: 'GET', url: '/api/health' })

  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.status, 'ok')
  assert.equal(body.name, 'village-mvp')
  assert.equal(typeof body.time, 'string')

  await app.close()
  db.close()
})
