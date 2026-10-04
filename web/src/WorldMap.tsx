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

function cellColor(cell: GridCell): string {
  if (cell.terrain === 'вода') return '#4a90d9'
  if (cell.terrain === 'болото') return '#3f6a3f'
  if (cell.terrain === 'песок') return '#c9b458'
  if (cell.terrain === 'пойма') return '#7dbd6a'
  switch (cell.flora) {
    case 'вырубка': return '#8a6b4a'
    case 'молодняк': return '#6aad4a'
    case 'смешанный': return '#4a8f3c'
    case 'зрелый': return '#2d5a2d'
    default: return '#4a8f3c'
  }
}

const FAUNA_COLORS: Record<string, string> = {
  заяц: '#e8e8e8',
  лиса: '#e07a2f',
  кабан: '#4a2f1a',
}

export const LEGEND: Array<[string, string]> = [
  ['#4a90d9', 'вода'],
  ['#3f6a3f', 'болото (сфагнум)'],
  ['#7dbd6a', 'пойма (луг)'],
  ['#c9b458', 'бор (песок)'],
  ['#8a6b4a', 'вырубка'],
  ['#6aad4a', 'молодняк'],
  ['#4a8f3c', 'смешанный лес'],
  ['#2d5a2d', 'зрелый лес'],
  ['#e8e8e8', 'заяц'],
  ['#e07a2f', 'лиса'],
  ['#4a2f1a', 'кабан'],
]

const MIN_CELL = 3
const MAX_CELL = 24
const DEFAULT_CELL = 10

/** Рендер сетки мира: клетка = цвет, фауна = точки; зум + клик для осмотра. */
export default function WorldMap({ seed = 7, day = 0 }: { seed?: number; day?: number }) {
  const [grid, setGrid] = useState<Grid | null>(null)
  const [selected, setSelected] = useState<GridCell | null>(null)
  const [faunaAt, setFaunaAt] = useState<FaunaPopulation[]>([])
  const [cellSize, setCellSize] = useState(DEFAULT_CELL)
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
    canvas.width = grid.width * cellSize
    canvas.height = grid.height * cellSize
    for (const cell of grid.cells) {
      ctx.fillStyle = cellColor(cell)
      ctx.fillRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize)
    }
    for (const pop of grid.fauna ?? []) {
      ctx.fillStyle = FAUNA_COLORS[pop.kind] ?? '#ffffff'
      const r = Math.max(2, Math.min(cellSize / 2, 1 + Math.log2(pop.count + 1)))
      ctx.beginPath()
      ctx.arc(pop.x * cellSize + cellSize / 2, pop.y * cellSize + cellSize / 2, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [grid, cellSize])

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !grid) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) / cellSize)
    const y = Math.floor((e.clientY - rect.top) / cellSize)
    setSelected(grid.cells.find((c) => c.x === x && c.y === y) ?? null)
    setFaunaAt(grid.fauna.filter((f) => f.x === x && f.y === y))
  }

  const zoom = (delta: number) => setCellSize((s) => Math.min(MAX_CELL, Math.max(MIN_CELL, s + delta)))

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <button onClick={() => zoom(-2)} title="Уменьшить">−</button>
        <input
          type="range"
          min={MIN_CELL}
          max={MAX_CELL}
          value={cellSize}
          onChange={(e) => setCellSize(Number(e.target.value))}
          style={{ width: 140 }}
        />
        <button onClick={() => zoom(2)} title="Увеличить">+</button>
        <span style={{ fontSize: '0.85rem', minWidth: '3rem' }}>{cellSize} px</span>
        <button onClick={() => setCellSize(DEFAULT_CELL)} style={{ fontSize: '0.8rem' }}>сброс</button>
      </div>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ border: '1px solid #333', imageRendering: 'pixelated', maxWidth: '100%', cursor: 'crosshair' }}
      />
      {selected && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
          <strong>
            Клетка ({selected.x}, {selected.y})
          </strong>
          : почва {selected.terrain}, флора {selected.flora}, влажность {Math.round(selected.moisture * 100)}%, возраст {selected.age} дн.
          {faunaAt.length > 0 && (
            <>
              {' '}· фауна: {faunaAt.map((f) => `${f.kind} ${f.count}`).join(', ')}
            </>
          )}
        </div>
      )}
    </div>
  )
}
