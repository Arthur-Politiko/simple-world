import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mulberry32, intRange } from './prng'
import { advanceTime, phaseName, PHASES } from './time'

export interface WorldRow {
  id: string
  name: string
  seed: number
  day: number
  phase: number
  created_at: string
}

export interface LocationRow {
  world_id: string
  id: string
  name: string
  kind: string
}

export interface HouseholdRow {
  world_id: string
  id: string
  name: string
  location_id: string
}

export interface CharacterRow {
  world_id: string
  id: string
  name: string
  location_id: string
  role: string
  energy: number
  household_id: string
}

export interface StockRow {
  world_id: string
  holder_type: string
  holder_id: string
  resource: string
  quantity: number
}

export interface GoalRow {
  id: number
  world_id: string
  character_id: string
  description: string
  priority: number
  status: string
}

export interface ObligationRow {
  id: number
  world_id: string
  character_id: string
  recipient: string
  resource: string
  amount: number
  due_day: number
  status: string
  settled_at: string | null
}

export interface FactRow {
  id: number
  world_id: string
  day: number
  type: string
  payload: unknown
}

export interface KnowledgeRow {
  id: number
  world_id: string
  character_id: string
  source: string
  summary: string
  fact_id: number | null
  event_id: number | null
  is_true: boolean
  day: number
}

export interface TraderRow {
  world_id: string
  money: number
  salt: number
  grain: number
  present: number
  present_day: number | null
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

export interface PlotRow {
  world_id: string
  household_id: string
  kind: string
  size: number
  harvest: number | null
}

export interface LivestockRow {
  world_id: string
  household_id: string
  kind: string
  count: number
  health: number
}

export interface WorldState {
  world: WorldRow
  phaseName: string
  locations: LocationRow[]
  households: HouseholdRow[]
  plots: PlotRow[]
  livestock: LivestockRow[]
  characters: CharacterRow[]
  stock: StockRow[]
  goals: GoalRow[]
  obligations: ObligationRow[]
  facts: FactRow[]
  knowledge: KnowledgeRow[]
  trader: TraderRow
  events: EventRow[]
}

/** Действие отклонено игровым правилом. */
export class RuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleError'
  }
}

export const MAX_ENERGY = 2
export const FOOD_RESOURCES = ['зерно', 'рыба', 'овощи'] as const

const FORAGE_PHASE = 1 // фаза «день»
const FORAGE_RESOURCE = 'ягоды'
// распределение зерна по наделам дворов: у земледельцев поле больше
const FIELD_HARVEST: Record<string, number> = {
  'hh-marta': 40,
  'hh-jan': 25,
  'hh-grzegorz': 10,
  'hh-inn': 5,
}
// скот: корм (зерно в день), продукт, тяга
const LIVESTOCK: Record<string, { title: string; feed: number; product?: string; productPerDay?: number; traction?: boolean }> = {
  корова: { title: 'корова', feed: 1, product: 'молоко', productPerDay: 1 },
  птица: { title: 'птица', feed: 0, product: 'яйца', productPerDay: 1 },
  вол: { title: 'вол', feed: 2, traction: true },
}
const COIN = 'монеты'

const TRADER_MONEY = 40
const TRADER_SALT = 10
const TRADER_GRAIN = 20
const ROAD_WASHOUT_DAYS = 4

// что торговец покупает у деревни (цена за единицу)
const BUY_PRICES: Record<string, number> = { дрова: 1, рыба: 2, ткань: 3 }
// что торговец продаёт деревне (цена за единицу)
const SELL_PRICES: Record<string, number> = { зерно: 2, соль: 2 }

interface RoleDef {
  title: string
  produces: string
  yieldPerWork: number
}

const ROLES: Record<string, RoleDef> = {
  zemledelec: { title: 'земледелец', produces: 'зерно', yieldPerWork: 2 },
  lesorub: { title: 'лесоруб', produces: 'дрова', yieldPerWork: 2 },
  rybak: { title: 'рыбак', produces: 'рыба', yieldPerWork: 1 },
  tkachiha: { title: 'ткачиха', produces: 'ткань', yieldPerWork: 1 },
  traktirschik: { title: 'трактирщик', produces: '', yieldPerWork: 0 },
}

const DEFAULT_LOCATIONS = [
  { id: 'loc-village', name: 'Деревня', kind: 'center' },
  { id: 'loc-field', name: 'Поле', kind: 'field' },
  { id: 'loc-forest', name: 'Лес', kind: 'forest' },
  { id: 'loc-river', name: 'Река', kind: 'river' },
  { id: 'loc-inn', name: 'Постоялый двор', kind: 'inn' },
]

const DEFAULT_HOUSEHOLDS = [
  { id: 'hh-marta', name: 'Хозяйство Марты', locationId: 'loc-village' },
  { id: 'hh-grzegorz', name: 'Хозяйство Гжегожа', locationId: 'loc-village' },
  { id: 'hh-jan', name: 'Хозяйство Яна', locationId: 'loc-village' },
  { id: 'hh-inn', name: 'Трактир', locationId: 'loc-inn' },
]

const DEFAULT_CHARACTERS = [
  { id: 'chr-marta', name: 'Марта', locationId: 'loc-village', role: 'zemledelec', householdId: 'hh-marta' },
  { id: 'chr-tomas', name: 'Томаш', locationId: 'loc-village', role: 'zemledelec', householdId: 'hh-marta' },
  { id: 'chr-grzegorz', name: 'Гжегож', locationId: 'loc-village', role: 'lesorub', householdId: 'hh-grzegorz' },
  { id: 'chr-kasya', name: 'Кася', locationId: 'loc-village', role: 'tkachiha', householdId: 'hh-grzegorz' },
  { id: 'chr-jan', name: 'Ян', locationId: 'loc-village', role: 'rybak', householdId: 'hh-jan' },
  { id: 'chr-staszek', name: 'Сташек', locationId: 'loc-village', role: 'zemledelec', householdId: 'hh-jan' },
  { id: 'chr-tomek', name: 'Томек', locationId: 'loc-inn', role: 'traktirschik', householdId: 'hh-inn' },
]

const INITIAL_STOCK = [
  { holderType: 'character', holderId: 'chr-marta', resource: 'зерно', quantity: 8 },
  { holderType: 'character', holderId: 'chr-tomas', resource: 'зерно', quantity: 6 },
  { holderType: 'character', holderId: 'chr-grzegorz', resource: 'зерно', quantity: 5 },
  { holderType: 'character', holderId: 'chr-kasya', resource: 'зерно', quantity: 5 },
  { holderType: 'character', holderId: 'chr-jan', resource: 'зерно', quantity: 5 },
  { holderType: 'character', holderId: 'chr-staszek', resource: 'зерно', quantity: 6 },
  { holderType: 'character', holderId: 'chr-tomek', resource: 'зерно', quantity: 4 },
  { holderType: 'character', holderId: 'chr-grzegorz', resource: 'дрова', quantity: 4 },
  { holderType: 'character', holderId: 'chr-marta', resource: 'дрова', quantity: 3 },
  { holderType: 'character', holderId: 'chr-tomas', resource: 'дрова', quantity: 3 },
  { holderType: 'character', holderId: 'chr-jan', resource: 'рыба', quantity: 2 },
  { holderType: 'character', holderId: 'chr-marta', resource: 'монеты', quantity: 8 },
  { holderType: 'character', holderId: 'chr-grzegorz', resource: 'монеты', quantity: 6 },
  { holderType: 'character', holderId: 'chr-jan', resource: 'монеты', quantity: 6 },
  { holderType: 'character', holderId: 'chr-tomek', resource: 'монеты', quantity: 5 },
]

const INITIAL_LIVESTOCK = [
  { householdId: 'hh-marta', kind: 'вол', count: 1 },
  { householdId: 'hh-marta', kind: 'корова', count: 1 },
  { householdId: 'hh-grzegorz', kind: 'корова', count: 1 },
  { householdId: 'hh-jan', kind: 'птица', count: 2 },
  { householdId: 'hh-inn', kind: 'птица', count: 1 },
]

const DEFAULT_GOALS = [
  { characterId: 'chr-marta', description: 'собрать урожай до заморозков', priority: 1 },
  { characterId: 'chr-marta', description: 'выплатить оброк сеньору', priority: 2 },
  { characterId: 'chr-grzegorz', description: 'заготовить дрова на зиму', priority: 1 },
  { characterId: 'chr-jan', description: 'обеспечить семью рыбой', priority: 1 },
  { characterId: 'chr-tomek', description: 'собирать и передавать новости', priority: 1 },
]

const DEFAULT_OBLIGATIONS = [
  { characterId: 'chr-marta', recipient: 'сеньор', resource: 'зерно', amount: 10, dueDay: 7 },
  { characterId: 'chr-grzegorz', recipient: 'сеньор', resource: 'дрова', amount: 6, dueDay: 7 },
  { characterId: 'chr-tomas', recipient: 'сеньор', resource: 'зерно', amount: 10, dueDay: 10 },
  { characterId: 'chr-marta', recipient: 'сеньор', resource: 'зерно', amount: 20, dueDay: 20 },
  { characterId: 'chr-grzegorz', recipient: 'сеньор', resource: 'зерно', amount: 15, dueDay: 20 },
  { characterId: 'chr-jan', recipient: 'сеньор', resource: 'зерно', amount: 15, dueDay: 20 },
]

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

function getTrader(db: DatabaseSync, worldId: string): TraderRow {
  const t = db.prepare('SELECT * FROM trader WHERE world_id = ?').get(worldId) as TraderRow | undefined
  if (!t) throw new RuleError('торговец не инициализирован')
  return t
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

function logEvent(db: DatabaseSync, worldId: string, day: number, phase: number, type: string, payload: unknown): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events WHERE world_id = ? AND day = ? AND phase = ?')
    .get(worldId, day, phase) as { maxSeq: number }
  const seq = row.maxSeq + 1
  const result = db.prepare(
    'INSERT INTO events (world_id, day, phase, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(worldId, day, phase, seq, type, JSON.stringify(payload), new Date().toISOString())
  return Number(result.lastInsertRowid)
}

function addFact(db: DatabaseSync, worldId: string, day: number, type: string, payload: unknown): number {
  const res = db
    .prepare('INSERT INTO facts (world_id, day, type, payload) VALUES (?, ?, ?, ?)')
    .run(worldId, day, type, JSON.stringify(payload))
  return Number(res.lastInsertRowid)
}

function deliverNews(
  db: DatabaseSync,
  worldId: string,
  day: number,
  phase: number,
  source: string,
  summary: string,
  isTrue: boolean,
  factId: number | null,
): void {
  const audience = db
    .prepare("SELECT * FROM characters WHERE world_id = ? AND location_id = 'loc-inn'")
    .all(worldId) as unknown as CharacterRow[]

  const newsEventId = logEvent(db, worldId, day, phase, 'news', {
    source,
    summary,
    isTrue,
    audience: audience.map((c) => c.id),
  })
  for (const c of audience) {
    db.prepare(
      'INSERT INTO knowledge (world_id, character_id, source, summary, fact_id, event_id, is_true, day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(worldId, c.id, source, summary, factId, newsEventId, isTrue ? 1 : 0, day)
  }
}

function forageAmount(seed: number, day: number): number {
  const rng = mulberry32((seed + day * 0x9e3779b9) >>> 0)
  return intRange(rng, 1, 5)
}

// ---------- автономная повседневная жизнь ----------

function simulatePhase(db: DatabaseSync, worldId: string, day: number, phase: number): void {
  if (phase === 0) {
    produceGardenVegetables(db, worldId, day, phase)
    tickLivestock(db, worldId, day, phase)
  }

  const chars = db.prepare('SELECT * FROM characters WHERE world_id = ? ORDER BY id').all(worldId) as unknown as CharacterRow[]

  for (const c of chars) {
    if (phase === 0 || phase === 2) {
      work(db, worldId, day, phase, c)
    } else if (phase === 1) {
      eat(db, worldId, day, phase, c)
    } else if (phase === 3) {
      sleep(db, worldId, day, phase, c)
    }
  }

  if (phase === 3) {
    settleObligations(db, worldId, day)
  }
}

/** Распределяет ресурс между членами двора; возвращает фактически выданное количество. */
function distributeToHousehold(db: DatabaseSync, worldId: string, householdId: string, resource: string, amount: number): number {
  const members = db
    .prepare('SELECT id FROM characters WHERE world_id = ? AND household_id = ? ORDER BY id')
    .all(worldId, householdId) as unknown as Array<{ id: string }>
  if (members.length === 0) return 0

  const per = Math.floor(amount / members.length)
  const remainder = amount % members.length
  let total = 0
  for (let i = 0; i < members.length; i++) {
    const a = per + (i === 0 ? remainder : 0)
    if (a <= 0) continue
    addStock(db, worldId, 'character', members[i].id, resource, a)
    total += a
  }
  return total
}

/** Списывает ресурс у членов двора (по очереди); возвращает фактически списанное. */
function consumeFromHousehold(db: DatabaseSync, worldId: string, householdId: string, resource: string, amount: number): number {
  const members = db
    .prepare('SELECT id FROM characters WHERE world_id = ? AND household_id = ? ORDER BY id')
    .all(worldId, householdId) as unknown as Array<{ id: string }>
  let remaining = amount
  for (const m of members) {
    if (remaining <= 0) break
    const have = stockOf(db, worldId, 'character', m.id, resource)
    const take = Math.min(have, remaining)
    if (take > 0) {
      addStock(db, worldId, 'character', m.id, resource, -take)
      remaining -= take
    }
  }
  return amount - remaining
}

/** Огород каждого двора даёт базовое пропитание (овощи), распределяемое между членами двора. */
function produceGardenVegetables(db: DatabaseSync, worldId: string, day: number, phase: number): void {
  const plots = db
    .prepare("SELECT household_id, size FROM plots WHERE world_id = ? AND kind = 'огород'")
    .all(worldId) as unknown as Array<{ household_id: string; size: number }>

  for (const plot of plots) {
    if (plot.size <= 0) continue
    const total = distributeToHousehold(db, worldId, plot.household_id, 'овощи', plot.size)
    if (total > 0) {
      logEvent(db, worldId, day, phase, 'garden_harvest', { householdId: plot.household_id, resource: 'овощи', amount: total })
    }
  }
}

/** Скот ест корм, даёт продукт, болеет и может пасть. */
function tickLivestock(db: DatabaseSync, worldId: string, day: number, phase: number): void {
  const world = getWorld(db, worldId)
  const rows = db
    .prepare('SELECT * FROM livestock WHERE world_id = ? ORDER BY household_id, kind')
    .all(worldId) as unknown as LivestockRow[]

  let idx = 0
  for (const lv of rows) {
    const spec = LIVESTOCK[lv.kind]
    if (!spec || lv.count <= 0) continue

    // корм
    const feedNeeded = lv.count * spec.feed
    const fed = consumeFromHousehold(db, worldId, lv.household_id, 'зерно', feedNeeded)

    // здоровье
    let health = lv.health
    if (fed >= feedNeeded) {
      health = Math.min(100, health + 5)
    } else {
      health = Math.max(0, health - 20)
    }

    // болезнь (детерминированно от seed + день + индекс)
    const rng = mulberry32((world.seed + day * 0x9e3779b9 + idx * 0x85ebca6b) >>> 0)
    idx++
    if (rng() < 0.08) {
      health = Math.max(0, health - 30)
      logEvent(db, worldId, day, phase, 'livestock_illness', { householdId: lv.household_id, kind: lv.kind })
    }

    // продукт
    if (health >= 40 && spec.product) {
      const amount = lv.count * (spec.productPerDay ?? 1)
      distributeToHousehold(db, worldId, lv.household_id, spec.product, amount)
      logEvent(db, worldId, day, phase, 'livestock_produce', { householdId: lv.household_id, kind: lv.kind, resource: spec.product, amount })
    }

    // смерть одной головы / обновление здоровья
    if (health <= 0) {
      const newCount = lv.count - 1
      if (newCount <= 0) {
        db.prepare('DELETE FROM livestock WHERE world_id = ? AND household_id = ? AND kind = ?').run(worldId, lv.household_id, lv.kind)
      } else {
        db.prepare('UPDATE livestock SET count = ?, health = 100 WHERE world_id = ? AND household_id = ? AND kind = ?').run(newCount, worldId, lv.household_id, lv.kind)
      }
      logEvent(db, worldId, day, phase, 'livestock_died', { householdId: lv.household_id, kind: lv.kind })
    } else {
      db.prepare('UPDATE livestock SET health = ? WHERE world_id = ? AND household_id = ? AND kind = ?').run(health, worldId, lv.household_id, lv.kind)
    }
  }
}

function work(db: DatabaseSync, worldId: string, day: number, phase: number, c: CharacterRow): void {
  const role = ROLES[c.role]
  if (!role || role.yieldPerWork <= 0) return

  if (c.energy < 1) {
    logEvent(db, worldId, day, phase, 'rest', { characterId: c.id, characterName: c.name, reason: 'усталость' })
    return
  }

  let amount = role.yieldPerWork
  if (role.produces === 'зерно') {
    // тяга вола увеличивает сбор
    const hasOx = db
      .prepare("SELECT 1 FROM livestock WHERE world_id = ? AND household_id = ? AND kind = 'вол' AND count > 0 AND health >= 40")
      .get(worldId, c.household_id)
    if (hasOx) amount += 1
    // сбор ограничен остатком урожая на наделе двора
    const plot = db
      .prepare("SELECT harvest FROM plots WHERE world_id = ? AND household_id = ? AND kind = 'поле'")
      .get(worldId, c.household_id) as { harvest: number | null } | undefined
    const pool = plot?.harvest ?? 0
    if (pool <= 0) {
      logEvent(db, worldId, day, phase, 'field_empty', { characterId: c.id, characterName: c.name, householdId: c.household_id })
      return
    }
    amount = Math.min(amount, pool)
    db.prepare("UPDATE plots SET harvest = harvest - ? WHERE world_id = ? AND household_id = ? AND kind = 'поле'").run(
      amount,
      worldId,
      c.household_id,
    )
  }

  db.prepare('UPDATE characters SET energy = energy - 1 WHERE world_id = ? AND id = ?').run(worldId, c.id)
  addStock(db, worldId, 'character', c.id, role.produces, amount)
  logEvent(db, worldId, day, phase, 'work', {
    characterId: c.id,
    characterName: c.name,
    role: role.title,
    resource: role.produces,
    amount,
  })
}

function eat(db: DatabaseSync, worldId: string, day: number, phase: number, c: CharacterRow): void {
  for (const food of FOOD_RESOURCES) {
    const have = stockOf(db, worldId, 'character', c.id, food)
    if (have >= 1) {
      addStock(db, worldId, 'character', c.id, food, -1)
      logEvent(db, worldId, day, phase, 'eat', {
        characterId: c.id,
        characterName: c.name,
        resource: food,
        amount: 1,
      })
      return
    }
  }
  logEvent(db, worldId, day, phase, 'hunger', { characterId: c.id, characterName: c.name })
}

function sleep(db: DatabaseSync, worldId: string, day: number, phase: number, c: CharacterRow): void {
  db.prepare('UPDATE characters SET energy = ? WHERE world_id = ? AND id = ?').run(MAX_ENERGY, worldId, c.id)
  logEvent(db, worldId, day, phase, 'sleep', { characterId: c.id, characterName: c.name })
}

function settleObligations(db: DatabaseSync, worldId: string, day: number): void {
  const pending = db
    .prepare("SELECT * FROM obligations WHERE world_id = ? AND due_day <= ? AND status = 'pending'")
    .all(worldId, day) as unknown as ObligationRow[]

  for (const ob of pending) {
    const have = stockOf(db, worldId, 'character', ob.character_id, ob.resource)
    if (have >= ob.amount) {
      addStock(db, worldId, 'character', ob.character_id, ob.resource, -ob.amount)
      db.prepare("UPDATE obligations SET status = 'fulfilled', settled_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        ob.id,
      )
      logEvent(db, worldId, day, 3, 'obligation_fulfilled', {
        obligationId: ob.id,
        characterId: ob.character_id,
        recipient: ob.recipient,
        resource: ob.resource,
        amount: ob.amount,
      })
    } else {
      db.prepare("UPDATE obligations SET status = 'failed', settled_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        ob.id,
      )
      logEvent(db, worldId, day, 3, 'obligation_failed', {
        obligationId: ob.id,
        characterId: ob.character_id,
        recipient: ob.recipient,
        resource: ob.resource,
        amount: ob.amount,
        have,
      })
    }
  }
}

// ---------- внешний мир: торговец, события, слухи ----------

function handleTraderVisit(db: DatabaseSync, worldId: string, day: number, phase: number): void {
  const washed = db
    .prepare('SELECT 1 AS x FROM facts WHERE world_id = ? AND type = ? AND day BETWEEN ? AND ?')
    .get(worldId, 'road_washout', day - ROAD_WASHOUT_DAYS, day)

  if (washed) {
    logEvent(db, worldId, day, phase, 'trader_cancelled', { reason: 'дорога размыта' })
    deliverNews(db, worldId, day, phase, 'торговец', 'не приехал — дорога размыта', true, null)
    return
  }

  db.prepare('UPDATE trader SET money = ?, salt = ?, grain = ?, present = 1, present_day = ? WHERE world_id = ?').run(
    TRADER_MONEY,
    TRADER_SALT,
    TRADER_GRAIN,
    day,
    worldId,
  )
  const factId = addFact(db, worldId, day, 'trader_arrived', {
    buyPrices: BUY_PRICES,
    sellPrices: SELL_PRICES,
  })
  deliverNews(db, worldId, day, phase, 'торговец', 'приехал и торгует', true, factId)
  logEvent(db, worldId, day, phase, 'trader_arrived', {
    money: TRADER_MONEY,
    salt: TRADER_SALT,
    grain: TRADER_GRAIN,
  })
}

// ---------- создание и продвижение мира ----------

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
      db.prepare('INSERT INTO locations (world_id, id, name, kind) VALUES (?, ?, ?, ?)').run(
        id,
        loc.id,
        loc.name,
        loc.kind,
      )
    }
    for (const hh of DEFAULT_HOUSEHOLDS) {
      db.prepare('INSERT INTO households (world_id, id, name, location_id) VALUES (?, ?, ?, ?)').run(
        id,
        hh.id,
        hh.name,
        hh.locationId,
      )
    }
    for (const hh of DEFAULT_HOUSEHOLDS) {
      // огород — базовое пропитание каждого двора
      db.prepare("INSERT INTO plots (world_id, household_id, kind, size) VALUES (?, ?, 'огород', ?)").run(id, hh.id, 3)
      // поле — зерно; у земледельцев поле больше
      const grain = FIELD_HARVEST[hh.id] ?? 8
      db.prepare("INSERT INTO plots (world_id, household_id, kind, size, harvest) VALUES (?, ?, 'поле', ?, ?)").run(id, hh.id, grain, grain)
    }
    for (const lv of INITIAL_LIVESTOCK) {
      db.prepare('INSERT INTO livestock (world_id, household_id, kind, count, health) VALUES (?, ?, ?, ?, 100)').run(id, lv.householdId, lv.kind, lv.count)
    }
    for (const chr of DEFAULT_CHARACTERS) {
      db.prepare(
        'INSERT INTO characters (world_id, id, name, location_id, role, energy, household_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, chr.id, chr.name, chr.locationId, chr.role, MAX_ENERGY, chr.householdId)
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
    for (const g of DEFAULT_GOALS) {
      db.prepare('INSERT INTO goals (world_id, character_id, description, priority) VALUES (?, ?, ?, ?)').run(
        id,
        g.characterId,
        g.description,
        g.priority,
      )
    }
    for (const o of DEFAULT_OBLIGATIONS) {
      db.prepare(
        'INSERT INTO obligations (world_id, character_id, recipient, resource, amount, due_day) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, o.characterId, o.recipient, o.resource, o.amount, o.dueDay)
    }

    db.prepare('INSERT INTO trader (world_id, money, salt, grain, present) VALUES (?, 0, 0, 0, 0)').run(id)

    // запланированные события
    db.prepare('INSERT INTO scheduled_events (world_id, due_day, due_phase, type, payload) VALUES (?, 1, ?, ?, ?)').run(
      id,
      FORAGE_PHASE,
      'forage',
      JSON.stringify({ resource: FORAGE_RESOURCE, locationId: 'loc-forest' }),
    )
    db.prepare('INSERT INTO scheduled_events (world_id, due_day, due_phase, type, payload) VALUES (?, 5, 0, ?, ?)').run(
      id,
      'trader_visit',
      '{}',
    )
    db.prepare('INSERT INTO scheduled_events (world_id, due_day, due_phase, type, payload) VALUES (?, 8, 0, ?, ?)').run(
      id,
      'road_washout',
      '{}',
    )
    db.prepare('INSERT INTO scheduled_events (world_id, due_day, due_phase, type, payload) VALUES (?, 9, 0, ?, ?)').run(
      id,
      'rumor',
      '{}',
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
      } else if (ev.type === 'trader_visit') {
        handleTraderVisit(db, worldId, next.day, next.phase)
        db.prepare('INSERT INTO scheduled_events (world_id, due_day, due_phase, type, payload) VALUES (?, ?, 0, ?, ?)').run(
          worldId,
          next.day + 5,
          ev.type,
          ev.payload,
        )
      } else if (ev.type === 'road_washout') {
        const factId = addFact(db, worldId, next.day, 'road_washout', {
          description: 'дорога размыта, торговец задержится',
        })
        deliverNews(db, worldId, next.day, next.phase, 'путник', 'дорога размыта — торговец задержится', true, factId)
      } else if (ev.type === 'rumor') {
        deliverNews(db, worldId, next.day, next.phase, 'путник', 'говорят, сеньор отменит оброк', false, null)
      }
    }

    simulatePhase(db, worldId, next.day, next.phase)

    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return getWorldState(db, worldId)
}

export function runDays(db: DatabaseSync, worldId: string, days: number): WorldState {
  getWorld(db, worldId)
  if (!Number.isInteger(days) || days <= 0) {
    throw new RuleError(`число дней должно быть положительным целым: ${days}`)
  }

  for (let i = 0; i < days * PHASES.length; i++) {
    advancePhase(db, worldId)
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

export function trade(
  db: DatabaseSync,
  worldId: string,
  characterId: string,
  action: string,
  resource: string,
  amount: number,
): WorldState {
  const world = getWorld(db, worldId)
  const chr = requireCharacter(db, worldId, characterId)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RuleError(`количество должно быть положительным целым: ${amount}`)
  }
  const trader = getTrader(db, worldId)
  if (!trader.present) {
    throw new RuleError('торговца сейчас нет в деревне')
  }

  db.exec('BEGIN')
  try {
    if (action === 'sell') {
      const price = BUY_PRICES[resource]
      if (!price) throw new RuleError(`торговец не покупает «${resource}»`)
      const have = stockOf(db, worldId, 'character', characterId, resource)
      if (have < amount) throw new RuleError(`недостаточно «${resource}»: есть ${have}, требуется ${amount}`)
      const coins = amount * price
      if (trader.money < coins) throw new RuleError(`у торговца мало денег: есть ${trader.money}, нужно ${coins}`)

      addStock(db, worldId, 'character', characterId, resource, -amount)
      addStock(db, worldId, 'character', characterId, COIN, coins)
      db.prepare('UPDATE trader SET money = money - ? WHERE world_id = ?').run(coins, worldId)
      logEvent(db, worldId, world.day, world.phase, 'trade_sell', {
        characterId,
        characterName: chr.name,
        resource,
        amount,
        coins,
      })
    } else if (action === 'buy') {
      const price = SELL_PRICES[resource]
      if (!price) throw new RuleError(`торговец не продаёт «${resource}»`)
      const cost = amount * price
      const coins = stockOf(db, worldId, 'character', characterId, COIN)
      if (coins < cost) throw new RuleError(`недостаточно монет: есть ${coins}, нужно ${cost}`)

      const traderStock = resource === 'зерно' ? trader.grain : resource === 'соль' ? trader.salt : 0
      if (traderStock < amount) throw new RuleError(`у торговца мало «${resource}»: есть ${traderStock}`)

      addStock(db, worldId, 'character', characterId, COIN, -cost)
      addStock(db, worldId, 'character', characterId, resource, amount)
      if (resource === 'зерно') {
        db.prepare('UPDATE trader SET grain = grain - ? WHERE world_id = ?').run(amount, worldId)
      } else {
        db.prepare('UPDATE trader SET salt = salt - ? WHERE world_id = ?').run(amount, worldId)
      }
      logEvent(db, worldId, world.day, world.phase, 'trade_buy', {
        characterId,
        characterName: chr.name,
        resource,
        amount,
        coins: cost,
      })
    } else {
      throw new RuleError(`неизвестное действие торговли: ${action}`)
    }
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
  const households = db.prepare('SELECT * FROM households WHERE world_id = ? ORDER BY id').all(worldId) as unknown as HouseholdRow[]
  const plots = db.prepare('SELECT * FROM plots WHERE world_id = ? ORDER BY household_id, kind').all(worldId) as unknown as PlotRow[]
  const livestock = db.prepare('SELECT * FROM livestock WHERE world_id = ? ORDER BY household_id, kind').all(worldId) as unknown as LivestockRow[]
  const characters = db.prepare('SELECT * FROM characters WHERE world_id = ? ORDER BY id').all(worldId) as unknown as CharacterRow[]
  const stock = db
    .prepare('SELECT * FROM stock WHERE world_id = ? ORDER BY holder_type, holder_id, resource')
    .all(worldId) as unknown as StockRow[]
  const goals = db.prepare('SELECT * FROM goals WHERE world_id = ? ORDER BY id').all(worldId) as unknown as GoalRow[]
  const obligations = db
    .prepare('SELECT * FROM obligations WHERE world_id = ? ORDER BY due_day, id')
    .all(worldId) as unknown as ObligationRow[]

  const facts = db.prepare('SELECT * FROM facts WHERE world_id = ? ORDER BY day, id').all(worldId) as unknown as Array<
    Omit<FactRow, 'payload'> & { payload: string }
  >
  const knowledge = db.prepare('SELECT * FROM knowledge WHERE world_id = ? ORDER BY day, id').all(worldId) as unknown as Array<
    Omit<KnowledgeRow, 'is_true'> & { is_true: number; event_id?: number | null }
  >
  const trader = getTrader(db, worldId)
  const events = db
    .prepare('SELECT * FROM events WHERE world_id = ? ORDER BY day, phase, seq')
    .all(worldId) as unknown as RawEventRow[]

  return {
    world,
    phaseName: phaseName(world.phase),
    locations,
    households,
    plots,
    livestock,
    characters,
    stock,
    goals,
    obligations,
    facts: facts.map((f) => ({ ...f, payload: JSON.parse(f.payload) as unknown })),
    knowledge: knowledge.map((k) => ({ ...k, event_id: k.event_id ?? null, is_true: k.is_true === 1 })),
    trader,
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

export interface WorldSummary {
  id: string
  name: string
  seed: number
  day: number
  phase: number
  created_at: string
}

export function listWorlds(db: DatabaseSync): WorldSummary[] {
  return db
    .prepare('SELECT id, name, seed, day, phase, created_at FROM worlds ORDER BY created_at')
    .all() as unknown as WorldSummary[]
}

/** Действие игрока: передать ресурс персонажу. */
export function gift(db: DatabaseSync, worldId: string, characterId: string, resource: string, amount: number): WorldState {
  const world = getWorld(db, worldId)
  const chr = requireCharacter(db, worldId, characterId)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RuleError(`количество должно быть положительным целым: ${amount}`)
  }

  db.exec('BEGIN')
  try {
    addStock(db, worldId, 'character', characterId, resource, amount)
    logEvent(db, worldId, world.day, world.phase, 'gift', {
      characterId,
      characterName: chr.name,
      resource,
      amount,
      source: 'player',
    })
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return getWorldState(db, worldId)
}
