import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import {
  advancePhase,
  consume,
  createWorld,
  gather,
  getWorldState,
  moveCharacter,
  runDays,
  RuleError,
} from './world'

export interface HealthResponse {
  status: string
  name: string
  time: string
}

interface IdParams {
  id: string
}

export function buildApp(db: DatabaseSync): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    name: 'village-mvp',
    time: new Date().toISOString(),
  }))

  app.post('/api/worlds', async (req) => {
    const body = (req.body ?? {}) as { name?: unknown; seed?: unknown }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Деревня'
    const seed = Number.isInteger(body.seed) ? (body.seed as number) : 1
    return createWorld(db, name, seed)
  })

  app.get<{ Params: IdParams }>('/api/worlds/:id', async (req) => {
    return getWorldState(db, req.params.id)
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/advance', async (req) => {
    return advancePhase(db, req.params.id)
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/move', async (req) => {
    const { characterId, locationId } = (req.body ?? {}) as { characterId?: unknown; locationId?: unknown }
    if (typeof characterId !== 'string' || typeof locationId !== 'string') {
      throw new RuleError('требуются characterId и locationId')
    }
    return moveCharacter(db, req.params.id, characterId, locationId)
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/gather', async (req) => {
    const { characterId, resource, amount } = (req.body ?? {}) as {
      characterId?: unknown
      resource?: unknown
      amount?: unknown
    }
    if (typeof characterId !== 'string' || typeof resource !== 'string') {
      throw new RuleError('требуются characterId и resource')
    }
    return gather(db, req.params.id, characterId, resource, Number(amount))
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/consume', async (req) => {
    const { characterId, resource, amount } = (req.body ?? {}) as {
      characterId?: unknown
      resource?: unknown
      amount?: unknown
    }
    if (typeof characterId !== 'string' || typeof resource !== 'string') {
      throw new RuleError('требуются characterId и resource')
    }
    return consume(db, req.params.id, characterId, resource, Number(amount))
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/run', async (req) => {
    const { days } = (req.body ?? {}) as { days?: unknown }
    return runDays(db, req.params.id, Number(days))
  })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof RuleError) {
      return reply.code(400).send({ error: err.message })
    }
    console.error('[village-mvp] unexpected error:', err)
    return reply.code(500).send({ error: 'internal error' })
  })

  return app
}
