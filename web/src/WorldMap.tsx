import { useEffect, useRef, useState } from 'react'

interface GridCell {
  x: number
  y: number
  terrain: string
  flora: string
  moisture: number
}

interface Grid {
  width: number
  height: number
  seed: number
  cells: GridCell[]
}

const TERRAIN_COLORS: Record<string, string> = {
  вода: '#4a90d9',
  болото: '#3f6a3f',
  пойма: '#7dbd6a',
  суглинок: '#4a8f3c',
  песок: '#c9b458',
}

/** Минимальный рендер сетки мира: клетка = цвет по почве/флоре (RimWorld-стиль). */
export default function WorldMap({ seed = 7 }: { seed?: number }) {
  const [grid, setGrid] = useState<Grid | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    fetch(`/api/grid?seed=${seed}`)
      .then((r) => r.json())
      .then((g) => setGrid(g as Grid))
      .catch(() => {})
  }, [seed])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !grid) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cellSize = 10
    canvas.width = grid.width * cellSize
    canvas.height = grid.height * cellSize
    for (const cell of grid.cells) {
      ctx.fillStyle = TERRAIN_COLORS[cell.terrain] ?? '#888888'
      ctx.fillRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize)
    }
  }, [grid])

  return (
    <canvas
      ref={canvasRef}
      style={{ border: '1px solid #333', imageRendering: 'pixelated', maxWidth: '100%' }}
    />
  )
}
