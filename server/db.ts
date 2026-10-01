import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SCHEMA_VERSION = 2

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new DatabaseSync(path)
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL')
  }
  migrate(db)
  return db
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
      PRIMARY KEY (world_id, id)
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

  if (!row) {
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION))
  } else if (Number(row.value) !== SCHEMA_VERSION) {
    throw new Error(`schema version mismatch: db=${row.value}, code=${SCHEMA_VERSION}`)
  }
}
