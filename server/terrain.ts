import { mulberry32 } from './prng'

export type TerrainType = 'вода' | 'болото' | 'пойма' | 'суглинок' | 'песок'

export interface GridCell {
  x: number
  y: number
  terrain: TerrainType
  flora: string
  moisture: number
  age: number
}

export interface Grid {
  width: number
  height: number
  seed: number
  cells: GridCell[]
}

/** Стадии сукцессии леса (дни до перехода). */
const FOREST_STAGES: Record<string, { days: number; next: string }> = {
  вырубка: { days: 10, next: 'молодняк' },
  молодняк: { days: 25, next: 'смешанный' },
  смешанный: { days: 60, next: 'зрелый' },
  зрелый: { days: Infinity, next: 'зрелый' },
}

/**
 * Генерация сетки мира (детерминированно от seed).
 * Шаги: суглинок (смешанный лес) → река (вода/пойма) → болото/озеро → песчаная гряда (бор) → вырубка.
 */
export function generateGrid(seed: number, width: number, height: number): Grid {
  const rng = mulberry32(seed >>> 0)
  const grid: GridCell[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({ x, y, terrain: 'суглинок' as TerrainType, flora: 'смешанный', moisture: 0.5, age: 0 })),
  )
  const inBounds = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height
  const set = (x: number, y: number, terrain: TerrainType, flora: string, moisture: number) => {
    if (inBounds(x, y)) grid[y][x] = { x, y, terrain, flora, moisture, age: 0 }
  }

  // река — меандр слева направо; по бокам пойма
  const riverBase = Math.floor(height * (0.35 + rng() * 0.3))
  for (let x = 0; x < width; x++) {
    const y = Math.max(1, Math.min(height - 2, Math.round(riverBase + Math.sin(x / 5) * 2 + (rng() - 0.5) * 2)))
    set(x, y, 'вода', 'вода', 1)
    set(x, y - 1, 'пойма', 'луг', 0.8)
    set(x, y + 1, 'пойма', 'луг', 0.8)
  }

  // болото/озеро — пятно в низине
  const bogX = Math.floor(width * 0.72)
  const bogY = Math.floor(height * 0.72)
  const bogR = 5 + Math.floor(rng() * 3)
  for (let dy = -bogR; dy <= bogR; dy++) {
    for (let dx = -bogR; dx <= bogR; dx++) {
      const x = bogX + dx
      const y = bogY + dy
      if (!inBounds(x, y)) continue
      const d2 = dx * dx + dy * dy
      if (d2 <= bogR * bogR) {
        if (d2 <= (bogR - 2) * (bogR - 2)) set(x, y, 'вода', 'вода', 1)
        else if (grid[y][x].terrain === 'суглинок') set(x, y, 'болото', 'сфагнум', 0.9)
      }
    }
  }

  // песчаная гряда (сосновый бор) наверху
  const ridgeY = Math.floor(height * 0.15)
  for (let x = 0; x < width; x += 4) {
    const cx = x + Math.floor(rng() * 2)
    const cy = ridgeY + Math.floor(rng() * 3) - 1
    if (inBounds(cx, cy) && grid[cy][cx].terrain === 'суглинок') set(cx, cy, 'песок', 'бор', 0.2)
  }

  // вырубка (подсека) — поляна, которую лес будет заращивать
  const clearX = Math.floor(width * 0.3)
  const clearY = Math.floor(height * 0.55)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = clearX + dx
      const y = clearY + dy
      if (inBounds(x, y) && grid[y][x].terrain === 'суглинок') set(x, y, 'суглинок', 'вырубка', 0.4)
    }
  }

  return { width, height, seed, cells: grid.flat() }
}

// Хранилище сеток по seed (в памяти; деревня свяжется позже).
const grids = new Map<number, Grid>()

export function getGrid(seed: number, width = 50, height = 40): Grid {
  let g = grids.get(seed)
  if (!g) {
    g = generateGrid(seed, width, height)
    grids.set(seed, g)
  }
  return g
}

const OFFSETS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
]

/**
 * Тик сетки (1 день): сукцессия стадий + взаимодействие соседей.
 * - лес (смешанный/зрелый) распространяется самосевом в вырубку/луг;
 * - болото подтапливает соседний суглинок.
 */
export function tickGrid(seed: number, day: number): void {
  const grid = grids.get(seed)
  if (!grid) return
  const rng = mulberry32((seed ^ day * 0x9e3779b9) >>> 0)
  const { width, height, cells } = grid
  const index = new Map(cells.map((c) => [`${c.x},${c.y}`, c]))
  const at = (x: number, y: number): GridCell | undefined => (x >= 0 && x < width && y >= 0 && y < height ? index.get(`${x},${y}`) : undefined)

  // 1) сукцессия: старение стадий леса
  for (const cell of cells) {
    const stage = FOREST_STAGES[cell.flora]
    if (!stage) continue
    cell.age += 1
    if (cell.age >= stage.days) {
      cell.flora = stage.next
      cell.age = 0
    }
  }

  // 2) взаимодействие соседей (собираем изменения, потом применяем)
  const changes: Array<[GridCell, TerrainType, string]> = []
  for (const cell of cells) {
    if (cell.terrain === 'болото') {
      for (const [dx, dy] of OFFSETS) {
        const n = at(cell.x + dx, cell.y + dy)
        if (n && n.terrain === 'суглинок' && rng() < 0.02) changes.push([n, 'болото', 'сфагнум'])
      }
    } else if (cell.flora === 'смешанный' || cell.flora === 'зрелый') {
      for (const [dx, dy] of OFFSETS) {
        const n = at(cell.x + dx, cell.y + dy)
        if (n && (n.flora === 'вырубка' || n.flora === 'луг') && rng() < 0.03) changes.push([n, n.terrain, 'молодняк'])
      }
    }
  }
  for (const [c, terrain, flora] of changes) {
    c.terrain = terrain
    c.flora = flora
    c.age = 0
  }
}
