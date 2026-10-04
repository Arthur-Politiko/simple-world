import { useEffect, useRef, useState } from 'react'

interface GridCell {
  x: number
  y: number
  terrain: string
  flora: string
  moisture: number
  age: number
}

interface FaunaPopulation {
  kind: string
  x: number
  y: number
  count: number
}

interface Grid {
  width: number
  height: number
  seed: number
  cells: GridCell[]
  fauna: FaunaPopulation[]
}

const FAUNA_COLORS: Record<string, string> = {
  заяц: '#e8e8e8',
  лиса: '#e07a2f',
  кабан: '#4a2f1a',
}

function cellColor(cell: GridCell): string {
  if (cell.terrain === 'вода') return '#4a90d9'
  if (cell.terrain === 'болото') return '#3f6a3f'
  if (cell.terrain === 'песок') return '#c9b458'
  if (cell.terrain === 'пойма') return '#7dbd6a'
  // суглинок — цвет по стадии сукцессии леса
  switch (cell.flora) {
    case 'вырубка': return '#8a6b4a'
    case 'молодняк': return '#6aad4a'
    case 'смешанный': return '#4a8f3c'
    case 'зрелый': return '#2d5a2d'
    default: return '#4a8f3c'
  }
}

/** Минимальный рендер сетки мира: клетка = цвет по почве/флоре (RimWorld-стиль). */
export default function WorldMap({ seed = 7, day = 0 }: { seed?: number; day?: number }) {
  const [grid, setGrid] = useState<Grid | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    fetch(`/api/grid?seed=${seed}`)
      .then((r) => r.json())
      .then((g) => setGrid(g as Grid))
      .catch(() => {})
  }, [seed, day])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !grid) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cellSize = 10
    canvas.width = grid.width * cellSize
    canvas.height = grid.height * cellSize
    for (const cell of grid.cells) {
      ctx.fillStyle = cellColor(cell)
      ctx.fillRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize)
    }
    // фауна — точки поверх клеток (размер зависит от численности)
    for (const pop of grid.fauna ?? []) {
      ctx.fillStyle = FAUNA_COLORS[pop.kind] ?? '#ffffff'
      const r = Math.max(2, Math.min(cellSize / 2, 1 + Math.log2(pop.count + 1)))
      ctx.beginPath()
      ctx.arc(pop.x * cellSize + cellSize / 2, pop.y * cellSize + cellSize / 2, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [grid])

  return (
    <canvas
      ref={canvasRef}
      style={{ border: '1px solid #333', imageRendering: 'pixelated', maxWidth: '100%' }}
    />
  )
}
