import { total } from '../data/series'
import type { Part } from '../data/series'

export type Column = {
  key: string
  // Short text under the column. Empty means no label for this one.
  tick: string
  // Full text for the tooltip, for example "Mon 5 Oct".
  name: string
  // The coloured pieces stacked in this column, bottom first.
  parts: Part[]
}

// The top of the scale: the smallest "round" number that fits the data in
// four equal steps, so every gridline is a whole number.
function scaleStep(max: number): number {
  for (const base of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
    if (base * 4 >= max) return base
  }
  return Math.ceil(max / 4)
}

type ColumnChartProps = {
  columns: Column[]
  // Word for what is being counted, used in tooltips: "3 entries".
  unit: [singular: string, plural: string]
}

function ColumnChart({ columns, unit }: ColumnChartProps) {
  const step = scaleStep(Math.max(1, ...columns.map((c) => total(c.parts))))
  const top = step * 4
  const ticks = [4, 3, 2, 1, 0].map((n) => n * step)
  const last = columns.length - 1

  return (
    <div className="chart">
      <div className="chart-scale" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick}>{tick.toLocaleString('en-IN')}</span>
        ))}
      </div>

      <div className="chart-plot">
        <div className="chart-grid" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} />
          ))}
        </div>

        <ul className="chart-columns">
          {columns.map((column, index) => {
            const sum = total(column.parts)
            return (
              <li
                key={column.key}
                tabIndex={0}
                // Tooltips near the edges open inwards so they are not cut off.
                className={index < 2 ? 'at-start' : index > last - 2 ? 'at-end' : ''}
              >
                <span className="chart-stack" style={{ height: `${(sum / top) * 100}%` }}>
                  {column.parts.map((part) => (
                    <span
                      key={part.name}
                      style={{ flexGrow: part.value, background: part.color }}
                    />
                  ))}
                </span>

                <span className="chart-tip">
                  <strong>{sum.toLocaleString('en-IN')}</strong>{' '}
                  {sum === 1 ? unit[0] : unit[1]}
                  <span>{column.name}</span>
                  {column.parts.length > 1 &&
                    column.parts.map((part) => (
                      <span className="chart-tip-row" key={part.name}>
                        <i style={{ background: part.color }} />
                        <strong>{part.value.toLocaleString('en-IN')}</strong> {part.name}
                      </span>
                    ))}
                </span>
              </li>
            )
          })}
        </ul>

        <div className="chart-ticks" aria-hidden="true">
          {columns.map((column) => (
            <span key={column.key}>{column.tick}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ColumnChart
