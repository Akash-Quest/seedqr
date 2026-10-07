import { total } from '../data/series'
import type { Part } from '../data/series'

export type BarRow = {
  name: string
  // The coloured pieces that make up this bar.
  parts: Part[]
}

// Horizontal bars with the name and value written out, so nothing depends
// on hovering.
function BarList({ rows }: { rows: BarRow[] }) {
  const max = Math.max(1, ...rows.map((row) => total(row.parts)))

  return (
    <ul className="bar-list">
      {rows.map((row) => {
        const sum = total(row.parts)
        return (
          <li key={row.name}>
            <span className="bar-name">{row.name}</span>
            <span className="bar-value">{sum.toLocaleString('en-IN')}</span>
            <span className="bar-track">
              <span style={{ width: `${(sum / max) * 100}%` }}>
                {row.parts.map((part) => (
                  <span
                    key={part.name}
                    title={`${part.name}: ${part.value}`}
                    style={{ flexGrow: part.value, background: part.color }}
                  />
                ))}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export default BarList
