import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { buildApp } from '../server/app'
import { createWorld } from '../server/world'

test('memory API читает JSON/wiki, применяет предложение и экспортирует Markdown', async () => {
  const db = openDb(':memory:')
  const app = buildApp(db)
  try {
    const world = createWorld(db, 'API memory', 3)
    const worldId = world.world.id
    const characterId = 'chr-marta'
    const eventId = world.events.find((event) => event.type === 'world_created')!.id

    const empty = await app.inject({ method: 'GET', url: `/api/worlds/${worldId}/characters/${characterId}/memory` })
    assert.equal(empty.statusCode, 200)
    assert.equal(empty.json().revision, 0)

    const applied = await app.inject({
      method: 'POST',
      url: `/api/worlds/${worldId}/memory/reflections`,
      payload: {
        characterId,
        proposalId: 'api-reflection-1',
        expectedRevision: 0,
        eventId,
        reason: 'Записать первое наблюдение.',
        core: 'Сдержанна, но ценит верность.',
      },
    })
    assert.equal(applied.statusCode, 200)
    assert.deepEqual(applied.json(), { status: 'applied', revision: 1 })

    const markdown = await app.inject({ method: 'GET', url: `/api/worlds/${worldId}/characters/${characterId}/memory.md` })
    assert.equal(markdown.statusCode, 200)
    assert.match(markdown.headers['content-type'] ?? '', /text\/markdown/)
    assert.match(markdown.body, /Сдержанна, но ценит верность/)

    const stale = await app.inject({
      method: 'POST',
      url: `/api/worlds/${worldId}/memory/reflections`,
      payload: { characterId, proposalId: 'api-stale', expectedRevision: 0, eventId, reason: 'Старое обновление.', currentState: 'Устарело.' },
    })
    assert.equal(stale.statusCode, 400)
  } finally {
    await app.close()
    db.close()
  }
})
