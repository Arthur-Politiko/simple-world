import { mulberry32 } from './prng'

export type TerrainType = 'вода' | 'болото' | 'пойма' | 'суглинок' | 'песок'

export interface GridCell {
  x: number
  y: number
  terrain: TerrainType
  flora: string
  moisture: number
}

export interface Grid {
  width: number
  height: number
  seed: number
  cells: GridCell[]
}

/**
 * Генерация сетки мира (детерминированно от seed).
 * Шаги: суглинок (смешанный лес) → река (вода/пойма) → болото/озеро → песчаная гряда (бор).
 */
export function generateGrid(seed: number, width: number, height: number): Grid {
  const rng = mulberry32(seed >>> 0)
  const grid: GridCell[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({ x, y, terrain: 'суглинок' as TerrainType, flora: 'смешанный', moisture: 0.5 })),
  )
  const inBounds = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height
  const set = (x: number, y: number, terrain: TerrainType, flora: string, moisture: number) => {
    if (inBounds(x, y)) grid[y][x] = { x, y, terrain, flora, moisture }
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

  return { width, height, seed, cells: grid.flat() }
}
