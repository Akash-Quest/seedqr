import { total } from '../data/series'
import type { Part } from '../data/series'

export type BarRow = {
  name: string
  // The coloured pieces that make up this bar.
  parts: Part[]
}

type BarListProps = {
  rows: BarRow[]
  // What every row is a share of. Given, each row also shows its percentage.
  whole?: number
}

// A ranked list of horizontal bars with the name and value written out, so
// nothing depends on hovering.
function BarList({ rows, whole }: BarListProps) {
  const max = Math.max(1, ...rows.map((row) => total(row.parts)))

  return (
    <ol className="bar-list">
      {rows.map((row, index) => {
        const sum = total(row.parts)
        const share = whole ? (sum / whole) * 100 : null
        return (
          <li key={row.name}>
            <span className="bar-rank" aria-hidden="true">
              {index + 1}
            </span>
            {/* A long name is cut after two lines; its title has the rest. */}
            <span className="bar-name" title={row.name}>
              {row.name}
            </span>
            <span className="bar-value">
              {sum.toLocaleString('en-IN')}
              {share !== null && (
                <small>{share > 0 && share < 1 ? 'under 1%' : `${Math.round(share)}%`}</small>
              )}
            </span>
            <span className="bar-track">
              <span style={{ width: `${(sum / max) * 100}%` }}>
                {row.parts.map((part) => (
                  <span
                    key={part.name}
                    title={`${part.name}: ${part.value.toLocaleString('en-IN')}`}
                    style={{ flexGrow: part.value, background: part.color }}
                  />
                ))}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export default BarList
