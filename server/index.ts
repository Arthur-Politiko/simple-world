import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app'
import { openDb } from './db'

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '127.0.0.1'
const dbPath = process.env.DB_PATH ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'village.db')

const db = openDb(dbPath)
const app = buildApp(db)

app
  .listen({ port, host })
  .then((address) => {
    console.log(`[village-mvp] server listening on ${address}`)
    console.log(`[village-mvp] db: ${dbPath}`)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
