import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SCHEMA_VERSION = 12

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL')
  }
  migrate(db)
  return db
}

function assertSchemaVersion(db: DatabaseSync): void {
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string } | undefined
  if (Number(row?.value) !== SCHEMA_VERSION) {
    throw new Error(`schema version mismatch: db=${row?.value ?? 'missing'}, code=${SCHEMA_VERSION}`)
  }
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS worlds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      seed INTEGER NOT NULL,
      day INTEGER NOT NULL DEFAULT 1,
      phase INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      world_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      PRIMARY KEY (world_id, id)
    );

    CREATE TABLE IF NOT EXISTS characters (
      world_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      location_id TEXT NOT NULL,
      role TEXT NOT NULL,
      energy INTEGER NOT NULL,
      household_id TEXT NOT NULL,
      PRIMARY KEY (world_id, id)
    );

    CREATE TABLE IF NOT EXISTS households (
      world_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      location_id TEXT NOT NULL,
      PRIMARY KEY (world_id, id)
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      description TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS obligations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      recipient TEXT NOT NULL,
      resource TEXT NOT NULL,
      amount INTEGER NOT NULL,
      due_day INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      day INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      source TEXT NOT NULL,
      summary TEXT NOT NULL,
      fact_id INTEGER,
      is_true INTEGER NOT NULL,
      day INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trader (
      world_id TEXT PRIMARY KEY,
      money INTEGER NOT NULL,
      salt INTEGER NOT NULL,
      grain INTEGER NOT NULL,
      present INTEGER NOT NULL DEFAULT 0,
      present_day INTEGER
    );

    CREATE TABLE IF NOT EXISTS stock (
      world_id TEXT NOT NULL,
      holder_type TEXT NOT NULL,
      holder_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      PRIMARY KEY (world_id, holder_type, holder_id, resource)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      day INTEGER NOT NULL,
      phase INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      due_day INTEGER NOT NULL,
      due_phase INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      processed_at TEXT
    );
  `)

  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined

  let currentVersion: number
  if (!row) {
    // Базовая схема в CREATE выше — это v4; свежая БД начинается с v4.
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema_version', '4')").run()
    currentVersion = 4
  } else {
    currentVersion = Number(row.value)
    if (!Number.isInteger(currentVersion) || currentVersion > SCHEMA_VERSION || currentVersion < 1) {
      throw new Error(`unsupported schema version: db=${row.value}, code=${SCHEMA_VERSION}`)
    }
  }

  if (currentVersion <= 4) migrateV4ToV5(db)
  if (currentVersion <= 5) migrateV5ToV6(db)
  if (currentVersion <= 6) migrateV6ToV7(db)
  if (currentVersion <= 7) migrateV7ToV8(db)
  if (currentVersion <= 8) migrateV8ToV9(db)
  if (currentVersion <= 9) migrateV9ToV10(db)
  if (currentVersion <= 10) migrateV10ToV11(db)
  if (currentVersion <= 11) migrateV11ToV12(db)
  assertSchemaVersion(db)
}

/** Add NPC memory and reflection-proposal tables without rewriting world state. */
function migrateV4ToV5(db: DatabaseSync): void {
  db.exec('BEGIN')
  try {
    const knowledgeColumns = db.prepare('PRAGMA table_info(knowledge)').all() as Array<{ name: string }>
    if (!knowledgeColumns.some((column) => column.name === 'event_id')) {
      db.exec('ALTER TABLE knowledge ADD COLUMN event_id INTEGER')
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS character_memory (
        world_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        core TEXT NOT NULL DEFAULT '',
        current_state TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (world_id, character_id),
        FOREIGN KEY (world_id, character_id) REFERENCES characters(world_id, id)
      );

      CREATE TABLE IF NOT EXISTS memory_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('recent', 'significant')),
        event_id INTEGER NOT NULL,
        knowledge_id INTEGER,
        content TEXT NOT NULL,
        importance INTEGER NOT NULL CHECK (importance BETWEEN 0 AND 100),
        created_at TEXT NOT NULL,
        FOREIGN KEY (world_id, character_id) REFERENCES characters(world_id, id),
        FOREIGN KEY (event_id) REFERENCES events(id),
        FOREIGN KEY (knowledge_id) REFERENCES knowledge(id)
      );
      CREATE INDEX IF NOT EXISTS memory_entries_character ON memory_entries(world_id, character_id, id);

      CREATE TABLE IF NOT EXISTS memory_relationships (
        world_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        note TEXT NOT NULL,
        trust INTEGER CHECK (trust BETWEEN -100 AND 100),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (world_id, character_id, target_id),
        FOREIGN KEY (world_id, character_id) REFERENCES characters(world_id, id)
      );

      CREATE TABLE IF NOT EXISTS memory_beliefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        statement TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('believed', 'uncertain', 'rejected')),
        confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
        knowledge_id INTEGER,
        updated_at TEXT NOT NULL,
        UNIQUE (world_id, character_id, statement),
        FOREIGN KEY (world_id, character_id) REFERENCES characters(world_id, id),
        FOREIGN KEY (knowledge_id) REFERENCES knowledge(id)
      );

      CREATE TABLE IF NOT EXISTS memory_proposals (
        world_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        event_id INTEGER NOT NULL,
        expected_revision INTEGER NOT NULL,
        resulting_revision INTEGER NOT NULL,
        reason TEXT NOT NULL,
        payload TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (world_id, character_id, proposal_id),
        FOREIGN KEY (world_id, character_id) REFERENCES characters(world_id, id),
        FOREIGN KEY (event_id) REFERENCES events(id)
      );

      CREATE TABLE IF NOT EXISTS memory_revisions (
        world_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        proposal_id TEXT NOT NULL,
        event_id INTEGER NOT NULL,
        core TEXT NOT NULL,
        current_state TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (world_id, character_id, revision),
        UNIQUE (world_id, character_id, proposal_id),
        FOREIGN KEY (world_id, character_id) REFERENCES characters(world_id, id),
        FOREIGN KEY (event_id) REFERENCES events(id)
      );
    `)
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'schema_version'").run('5')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Add the LLM usage/cost metrics table. */
function migrateV5ToV6(db: DatabaseSync): void {
  db.exec('BEGIN')
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER NOT NULL,
        cache_hit_tokens INTEGER NOT NULL,
        cache_miss_tokens INTEGER NOT NULL,
        cost REAL,
        created_at TEXT NOT NULL
      );
    `)
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'schema_version'").run('6')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Add the NPC decisions table for the decision chain. */
function migrateV6ToV7(db: DatabaseSync): void {
  db.exec('BEGIN')
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        phase INTEGER NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        amount INTEGER,
        reason TEXT NOT NULL,
        outcome TEXT NOT NULL,
        error TEXT,
        memory_revision INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'schema_version'").run('7')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Add short traces for evicted relationship profiles. */
function migrateV7ToV8(db: DatabaseSync): void {
  db.exec('BEGIN')
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS relationship_traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        note TEXT NOT NULL,
        evicted_at TEXT NOT NULL
      );
    `)
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'schema_version'").run('8')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Add household plots (наделы): огород и поле. */
function migrateV8ToV9(db: DatabaseSync): void {
  db.exec('BEGIN')
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plots (
        world_id TEXT NOT NULL,
        household_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        harvest INTEGER,
        PRIMARY KEY (world_id, household_id, kind)
      );
    `)
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'schema_version'").run('9')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Add livestock (скот) per household. */
function migrateV9ToV10(db: DatabaseSync): void {
  db.exec('BEGIN')
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS livestock (
        world_id TEXT NOT NULL,
        household_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        count INTEGER NOT NULL,
        health INTEGER NOT NULL,
        PRIMARY KEY (world_id, household_id, kind)
      );
    `)
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'schema_version'").run('10')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Add health to characters (болезнь/перегруз). */
function migrateV10ToV11(db: DatabaseSync): void {
  db.exec('BEGIN')
  try {
    const columns = db.prepare('PRAGMA table_info(characters)').all() as Array<{ name: string }>
    if (!columns.some((c) => c.name === 'health')) {
      db.exec('ALTER TABLE characters ADD COLUMN health INTEGER NOT NULL DEFAULT 100')
    }
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'schema_version'").run('11')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Add sown (посев) to plots for the yearly cycle. */
function migrateV11ToV12(db: DatabaseSync): void {
  db.exec('BEGIN')
  try {
    const columns = db.prepare('PRAGMA table_info(plots)').all() as Array<{ name: string }>
    if (!columns.some((c) => c.name === 'sown')) {
      db.exec('ALTER TABLE plots ADD COLUMN sown INTEGER')
    }
    if (!columns.some((c) => c.name === 'manure')) {
      db.exec('ALTER TABLE plots ADD COLUMN manure INTEGER')
    }
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
