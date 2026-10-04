import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { applyReflectionProposal, exportCharacterMemoryMarkdown, getCharacterMemory } from './memory'
import { chooseIntention, getDecisionChain, reflectOnEvent, talkToCharacter } from './agent'
import { getLLMUsageSummary } from './metrics'
import { consolidateMemory } from './forgetting'
import { runDaysWithAutonomy } from './autonomous'
import { getAuto, startAuto, stopAuto } from './scheduler'
import { generateGrid } from './terrain'
import {
  advancePhase,
  consume,
  createWorld,
  gather,
  getWorldState,
  gift,
  listWorlds,
  moveCharacter,
  promoteDependent,
  runDays,
  trade,
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

  app.get<{ Querystring: { seed?: string; w?: string; h?: string } }>('/api/grid', async (req) => {
    const seed = parseInt(req.query.seed ?? '7', 10) || 7
    const w = Math.min(200, Math.max(10, parseInt(req.query.w ?? '50', 10) || 50))
    const h = Math.min(200, Math.max(10, parseInt(req.query.h ?? '40', 10) || 40))
    return generateGrid(seed, w, h)
  })

  app.post('/api/worlds', async (req) => {
    const body = (req.body ?? {}) as { name?: unknown; seed?: unknown }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Деревня'
    const seed = Number.isInteger(body.seed) ? (body.seed as number) : 1
    return createWorld(db, name, seed)
  })

  app.get('/api/worlds', async () => {
    return listWorlds(db)
  })

  app.get<{ Params: IdParams }>('/api/worlds/:id', async (req) => {
    return getWorldState(db, req.params.id)
  })

  app.get<{ Params: { id: string; characterId: string } }>('/api/worlds/:id/characters/:characterId/memory', async (req) => {
    return getCharacterMemory(db, req.params.id, req.params.characterId)
  })

  app.get<{ Params: { id: string; characterId: string } }>('/api/worlds/:id/characters/:characterId/memory.md', async (req, reply) => {
    const memory = getCharacterMemory(db, req.params.id, req.params.characterId)
    const world = getWorldState(db, req.params.id)
    const character = world.characters.find((item) => item.id === req.params.characterId)
    if (!character) throw new RuleError(`персонаж не найден: ${req.params.characterId}`)
    return reply.type('text/markdown; charset=utf-8').send(exportCharacterMemoryMarkdown(memory, character.name))
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/memory/reflections', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    return applyReflectionProposal(db, { ...body, worldId: req.params.id })
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

  app.post<{ Params: IdParams }>('/api/worlds/:id/trade', async (req) => {
    const { characterId, action, resource, amount } = (req.body ?? {}) as {
      characterId?: unknown
      action?: unknown
      resource?: unknown
      amount?: unknown
    }
    if (typeof characterId !== 'string' || typeof action !== 'string' || typeof resource !== 'string') {
      throw new RuleError('требуются characterId, action и resource')
    }
    return trade(db, req.params.id, characterId, action, resource, Number(amount))
  })

  app.get('/api/metrics/llm', async () => {
    return getLLMUsageSummary(db)
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/reflect', async (req) => {
    const { characterId, eventId } = (req.body ?? {}) as { characterId?: unknown; eventId?: unknown }
    if (typeof characterId !== 'string') throw new RuleError('требуется characterId')
    const eid = Number(eventId)
    if (!Number.isInteger(eid)) throw new RuleError('требуется целочисленный eventId')
    return reflectOnEvent(db, req.params.id, characterId, eid)
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/intention', async (req) => {
    const { characterId } = (req.body ?? {}) as { characterId?: unknown }
    if (typeof characterId !== 'string') throw new RuleError('требуется characterId')
    return chooseIntention(db, req.params.id, characterId)
  })

  app.post<{ Params: { id: string; characterId: string } }>('/api/worlds/:id/characters/:characterId/talk', async (req) => {
    const { message } = (req.body ?? {}) as { message?: unknown }
    if (typeof message !== 'string' || !message.trim()) throw new RuleError('требуется message')
    return talkToCharacter(db, req.params.id, req.params.characterId, message)
  })

  app.get<{ Params: { id: string; characterId: string } }>('/api/worlds/:id/characters/:characterId/chain', async (req) => {
    return getDecisionChain(db, req.params.id, req.params.characterId)
  })

  app.post<{ Params: { id: string; characterId: string } }>('/api/worlds/:id/characters/:characterId/consolidate', async (req) => {
    return consolidateMemory(db, req.params.id, req.params.characterId)
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/gift', async (req) => {
    const { characterId, resource, amount } = (req.body ?? {}) as {
      characterId?: unknown
      resource?: unknown
      amount?: unknown
    }
    if (typeof characterId !== 'string' || typeof resource !== 'string') {
      throw new RuleError('требуются characterId и resource')
    }
    return gift(db, req.params.id, characterId, resource, Number(amount))
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/run-autonomous', async (req) => {
    const { days } = (req.body ?? {}) as { days?: unknown }
    const d = Number.isInteger(days) && (days as number) > 0 ? (days as number) : 1
    return runDaysWithAutonomy(db, req.params.id, d)
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/auto', async (req) => {
    const { intervalMs } = (req.body ?? {}) as { intervalMs?: unknown }
    const ms = Number.isInteger(intervalMs) && (intervalMs as number) > 0 ? (intervalMs as number) : 1000
    return startAuto(db, req.params.id, ms)
  })

  app.post<{ Params: IdParams }>('/api/worlds/:id/auto-stop', async (req) => {
    return stopAuto(req.params.id)
  })

  app.post<{ Params: { id: string; dependentId: string } }>('/api/worlds/:id/dependents/:dependentId/promote', async (req) => {
    const { role } = (req.body ?? {}) as { role?: unknown }
    return promoteDependent(db, req.params.id, req.params.dependentId, typeof role === 'string' ? role : 'работник')
  })

  app.get<{ Params: IdParams }>('/api/worlds/:id/auto', async (req) => {
    return getAuto(req.params.id)
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
