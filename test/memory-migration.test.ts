import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDb, SCHEMA_VERSION } from '../server/db'

test('существующая база v4 мигрирует в v6 (через v5), сохраняя knowledge rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'village-memory-migration-'))
  const path = join(dir, 'legacy.db')
  let migrated: DatabaseSync | null = null
  try {
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO schema_meta (key, value) VALUES ('schema_version', '4');
      CREATE TABLE knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        source TEXT NOT NULL,
        summary TEXT NOT NULL,
        fact_id INTEGER,
        is_true INTEGER NOT NULL,
        day INTEGER NOT NULL
      );
      INSERT INTO knowledge (world_id, character_id, source, summary, fact_id, is_true, day)
      VALUES ('old-world', 'old-npc', 'путник', 'старое знание', NULL, 0, 9);
    `)
    legacy.close()

    migrated = openDb(path)
    const version = migrated.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string }
    const row = migrated.prepare('SELECT * FROM knowledge').get() as Record<string, unknown>
    const columns = migrated.prepare('PRAGMA table_info(knowledge)').all() as Array<{ name: string }>

    assert.equal(SCHEMA_VERSION, 17)
    assert.equal(version.value, '17')
    assert.equal(row.summary, 'старое знание')
    assert.equal(row.event_id, null, 'legacy knowledge has no retroactively invented event link')
    assert.ok(columns.some((column) => column.name === 'event_id'))
    assert.ok(migrated.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_revisions'").get())
    assert.ok(migrated.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='llm_calls'").get())
  } finally {
    if (migrated) migrated.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
