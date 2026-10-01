import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mulberry32, intRange } from './prng'
import { advanceTime, phaseName } from './time'

export interface WorldRow {
  id: string
  name: string
  seed: number
  day: number
  phase: number
  created_at: string
}

export interface LocationRow {
  id: string
  world_id: string
  name: string
  kind: string
}

export interface CharacterRow {
  id: string
  world_id: string
  name: string
  location_id: string
}

export interface StockRow {
  world_id: string
  holder_type: string
  holder_id: string
  resource: string
  quantity: number
}

export interface EventRow {
  id: number
  world_id: string
  day: number
  phase: number
  seq: number
  type: string
  payload: unknown
  created_at: string
}

export interface WorldState {
  world: WorldRow
  phaseName: string
  locations: LocationRow[]
  characters: CharacterRow[]
  stock: StockRow[]
  events: EventRow[]
}

/** Действие отклонено игровым правилом. */
export class RuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleError'
  }
}

const DEFAULT_LOCATIONS = [
  { id: 'loc-village', name: 'Деревня', kind: 'center' },
  { id: 'loc-field', name: 'Поле', kind: 'field' },
  { id: 'loc-forest', name: 'Лес', kind: 'forest' },
  { id: 'loc-river', name: 'Река', kind: 'river' },
  { id: 'loc-inn', name: 'Постоялый двор', kind: 'inn' },
]

const DEFAULT_CHARACTERS = [
  { id: 'chr-marta', name: 'Марта', locationId: 'loc-village' },
  { id: 'chr-tomas', name: 'Томаш', locationId: 'loc-village' },
]

const INITIAL_STOCK = [
  { holderType: 'character', holderId: 'chr-marta', resource: 'зерно', quantity: 5 },
  { holderType: 'character', holderId: 'chr-marta', resource: 'дрова', quantity: 3 },
  { holderType: 'character', holderId: 'chr-tomas', resource: 'зерно', quantity: 4 },
  { holderType: 'character', holderId: 'chr-tomas', resource: 'дрова', quantity: 2 },
]

const FORAGE_PHASE = 1 // фаза «день»

function getWorld(db: DatabaseSync, worldId: string): WorldRow {
  const w = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId) as WorldRow | undefined
  if (!w) throw new RuleError(`мир не найден: ${worldId}`)
  return w
}

function requireCharacter(db: DatabaseSync, worldId: string, characterId: string): CharacterRow {
  const c = db
    .prepare('SELECT * FROM characters WHERE id = ? AND world_id = ?')
    .get(characterId, worldId) as CharacterRow | undefined
  if (!c) throw new RuleError(`персонаж не найден: ${characterId}`)
  return c
}

function requireLocation(db: DatabaseSync, worldId: string, locationId: string): LocationRow {
  const l = db
    .prepare('SELECT * FROM locations WHERE id = ? AND world_id = ?')
    .get(locationId, worldId) as LocationRow | undefined
  if (!l) throw new RuleError(`локация не найдена: ${locationId}`)
  return l
}

function addStock(
  db: DatabaseSync,
  worldId: string,
  holderType: string,
  holderId: string,
  resource: string,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO stock (world_id, holder_type, holder_id, resource, quantity)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (world_id, holder_type, holder_id, resource)
     DO UPDATE SET quantity = quantity + excluded.quantity`,
  ).run(worldId, holderType, holderId, resource, amount)
}

function stockOf(
  db: DatabaseSync,
  worldId: string,
  holderType: string,
  holderId: string,
  resource: string,
): number {
  const row = db
    .prepare(
      'SELECT quantity FROM stock WHERE world_id = ? AND holder_type = ? AND holder_id = ? AND resource = ?',
    )
    .get(worldId, holderType, holderId, resource) as { quantity: number } | undefined
  return row?.quantity ?? 0
}

function logEvent(db: DatabaseSync, worldId: string, day: number, phase: number, type: string, payload: unknown): void {
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events WHERE world_id = ? AND day = ? AND phase = ?')
    .get(worldId, day, phase) as { maxSeq: number }
  const seq = row.maxSeq + 1
  db.prepare(
    'INSERT INTO events (world_id, day, phase, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(worldId, day, phase, seq, type, JSON.stringify(payload), new Date().toISOString())
}

function forageAmount(seed: number, day: number): number {
  const rng = mulberry32((seed + day * 0x9e3779b9) >>> 0)
  return intRange(rng, 1, 5)
}

export function createWorld(db: DatabaseSync, name: string, seed: number): WorldState {
  const id = randomUUID()
  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    db.prepare('INSERT INTO worlds (id, name, seed, day, phase, created_at) VALUES (?, ?, ?, 1, 0, ?)').run(
      id,
      name,
      seed,
      now,
    )

    for (const loc of DEFAULT_LOCATIONS) {
      db.prepare('INSERT INTO locations (id, world_id, name, kind) VALUES (?, ?, ?, ?)').run(
        loc.id,
        id,
        loc.name,
        loc.kind,
      )
    }
    for (const chr of DEFAULT_CHARACTERS) {
      db.prepare('INSERT INTO characters (id, world_id, name, location_id) VALUES (?, ?, ?, ?)').run(
        chr.id,
        id,
        chr.name,
        chr.locationId,
      )
    }
    for (const s of INITIAL_STOCK) {
      db.prepare('INSERT INTO stock (world_id, holder_type, holder_id, resource, quantity) VALUES (?, ?, ?, ?, ?)').run(
        id,
        s.holderType,
        s.holderId,
        s.resource,
        s.quantity,
      )
    }

    db.prepare('INSERT INTO scheduled_events (world_id, due_day, due_phase, type, payload) VALUES (?, 1, ?, ?, ?)').run(
      id,
      FORAGE_PHASE,
      'forage',
      JSON.stringify({ resource: 'ягоды', locationId: 'loc-forest' }),
    )

    logEvent(db, id, 1, 0, 'world_created', { name, seed })
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return getWorldState(db, id)
}

interface ScheduledRow {
  id: number
  world_id: string
  due_day: number
  due_phase: number
  type: string
  payload: string
  processed_at: string | null
}

export function advancePhase(db: DatabaseSync, worldId: string): WorldState {
  const world = getWorld(db, worldId)
  const next = advanceTime(world.day, world.phase)

  db.exec('BEGIN')
  try {
    db.prepare('UPDATE worlds SET day = ?, phase = ? WHERE id = ?').run(next.day, next.phase, worldId)
    logEvent(db, worldId, next.day, next.phase, 'phase_advanced', { phase: phaseName(next.phase) })

    const due = db
      .prepare(
        'SELECT * FROM scheduled_events WHERE world_id = ? AND due_day = ? AND due_phase = ? AND processed_at IS NULL ORDER BY id',
      )
      .all(worldId, next.day, next.phase) as unknown as ScheduledRow[]

    for (const ev of due) {
      db.prepare('UPDATE scheduled_events SET processed_at = ? WHERE id = ?').run(new Date().toISOString(), ev.id)

      if (ev.type === 'forage') {
        const payload = JSON.parse(ev.payload) as { resource: string; locationId: string }
        const amount = forageAmount(world.seed, next.day)
        addStock(db, worldId, 'location', payload.locationId, payload.resource, amount)
        logEvent(db, worldId, next.day, next.phase, 'forage', {
          locationId: payload.locationId,
          resource: payload.resource,
          amount,
        })
        db.prepare('INSERT INTO scheduled_events (world_id, due_day, due_phase, type, payload) VALUES (?, ?, ?, ?, ?)').run(
          worldId,
          next.day + 1,
          FORAGE_PHASE,
          ev.type,
          ev.payload,
        )
      }
    }

    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return getWorldState(db, worldId)
}

export function moveCharacter(db: DatabaseSync, worldId: string, characterId: string, locationId: string): WorldState {
  const world = getWorld(db, worldId)
  const chr = requireCharacter(db, worldId, characterId)
  requireLocation(db, worldId, locationId)

  db.exec('BEGIN')
  try {
    db.prepare('UPDATE characters SET location_id = ? WHERE world_id = ? AND id = ?').run(locationId, worldId, characterId)
    logEvent(db, worldId, world.day, world.phase, 'move', {
      characterId,
      characterName: chr.name,
      from: chr.location_id,
      to: locationId,
    })
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return getWorldState(db, worldId)
}

export function gather(db: DatabaseSync, worldId: string, characterId: string, resource: string, amount: number): WorldState {
  const world = getWorld(db, worldId)
  const chr = requireCharacter(db, worldId, characterId)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RuleError(`количество должно быть положительным целым: ${amount}`)
  }

  db.exec('BEGIN')
  try {
    addStock(db, worldId, 'character', characterId, resource, amount)
    logEvent(db, worldId, world.day, world.phase, 'gather', {
      characterId,
      characterName: chr.name,
      locationId: chr.location_id,
      resource,
      amount,
    })
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return getWorldState(db, worldId)
}

export function consume(db: DatabaseSync, worldId: string, characterId: string, resource: string, amount: number): WorldState {
  const world = getWorld(db, worldId)
  const chr = requireCharacter(db, worldId, characterId)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RuleError(`количество должно быть положительным целым: ${amount}`)
  }

  const have = stockOf(db, worldId, 'character', characterId, resource)
  if (have < amount) {
    throw new RuleError(`недостаточно «${resource}»: есть ${have}, требуется ${amount}`)
  }

  db.exec('BEGIN')
  try {
    addStock(db, worldId, 'character', characterId, resource, -amount)
    logEvent(db, worldId, world.day, world.phase, 'consume', {
      characterId,
      characterName: chr.name,
      resource,
      amount,
    })
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return getWorldState(db, worldId)
}

interface RawEventRow {
  id: number
  world_id: string
  day: number
  phase: number
  seq: number
  type: string
  payload: string
  created_at: string
}

export function getWorldState(db: DatabaseSync, worldId: string): WorldState {
  const world = getWorld(db, worldId)
  const locations = db.prepare('SELECT * FROM locations WHERE world_id = ? ORDER BY id').all(worldId) as unknown as LocationRow[]
  const characters = db.prepare('SELECT * FROM characters WHERE world_id = ? ORDER BY id').all(worldId) as unknown as CharacterRow[]
  const stock = db
    .prepare('SELECT * FROM stock WHERE world_id = ? ORDER BY holder_type, holder_id, resource')
    .all(worldId) as unknown as StockRow[]
  const events = db
    .prepare('SELECT * FROM events WHERE world_id = ? ORDER BY day, phase, seq')
    .all(worldId) as unknown as RawEventRow[]

  return {
    world,
    phaseName: phaseName(world.phase),
    locations,
    characters,
    stock,
    events: events.map((e) => ({
      id: e.id,
      world_id: e.world_id,
      day: e.day,
      phase: e.phase,
      seq: e.seq,
      type: e.type,
      payload: JSON.parse(e.payload) as unknown,
      created_at: e.created_at,
    })),
  }
}
