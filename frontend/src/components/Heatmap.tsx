import { useState } from 'react'
import { hourName } from '../data/insights'

// Weeks start on Monday in the office; the server counts Sunday as day 0.
const DAYS = [1, 2, 3, 4, 5, 6, 0]
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// One hue, light to dark: how many entries, never which kind.
const STEPS = ['#cde2fb', '#9ec5f4', '#5598e7', '#256abf', '#104281']

function hours(hour: number): string {
  return `${hourName(hour)} to ${hourName((hour + 1) % 24)}`
}

// A small count still shows: the square root lifts the lower steps.
function step(value: number, top: number): number {
  if (value <= 0 || top <= 0) return -1
  return Math.min(STEPS.length - 1, Math.floor(Math.sqrt(value / top) * STEPS.length))
}

type HeatmapProps = {
  // Seven rows (Sunday first) of 24 hourly counts.
  counts: number[][]
}

// When entries come in: day of the week down the side, hour along the top.
function Heatmap({ counts }: HeatmapProps) {
  const [hovered, setHovered] = useState<[number, number] | null>(null)
  const [asTable, setAsTable] = useState(false)
  const top = Math.max(0, ...counts.flat())
  const total = counts.flat().reduce((sum, n) => sum + n, 0)

  let busiest: [number, number] = [1, 0]
  for (const day of DAYS) {
    for (let hour = 0; hour < 24; hour++) {
      if (counts[day][hour] > counts[busiest[0]][busiest[1]]) busiest = [day, hour]
    }
  }
  const [shownDay, shownHour] = hovered ?? busiest
  const shownCount = counts[shownDay]?.[shownHour] ?? 0

  return (
    <div className="heatmap">
      <div className="heatmap-bar">
        <p className="heatmap-readout" aria-live="off">
          {total === 0 ? (
            'Nothing yet in this period.'
          ) : (
            <>
              <strong>{shownCount.toLocaleString('en-IN')}</strong>{' '}
              {shownCount === 1 ? 'entry' : 'entries'} on {DAY_NAMES[shownDay]}s,{' '}
              {hours(shownHour)}
              {!hovered && <span className="muted"> · the busiest hour</span>}
            </>
          )}
        </p>
        <button
          type="button"
          className="link-button"
          aria-pressed={asTable}
          onClick={() => setAsTable(!asTable)}
        >
          {asTable ? 'Show as a chart' : 'Show as a table'}
        </button>
      </div>

      {asTable ? (
        <DayTable counts={counts} />
      ) : (
        <>
          <div
            className="heatmap-grid"
            role="img"
            aria-label={`Entries by day of the week and hour. Busiest: ${DAY_NAMES[busiest[0]]}s, ${hours(busiest[1])}.`}
            onPointerLeave={() => setHovered(null)}
          >
            {DAYS.map((day) => (
              <div className="heatmap-row" key={day}>
                <span className="heatmap-day">{DAY_NAMES[day].slice(0, 3)}</span>
                {counts[day].map((value, hour) => {
                  const level = step(value, top)
                  const on = hovered?.[0] === day && hovered?.[1] === hour
                  return (
                    <span
                      key={hour}
                      className={`heatmap-cell${on ? ' on' : ''}`}
                      style={{
                        background: level < 0 ? undefined : STEPS[level],
                        animationDelay: `${hour * 14 + DAYS.indexOf(day) * 30}ms`,
                      }}
                      onPointerEnter={() => setHovered([day, hour])}
                    />
                  )
                })}
              </div>
            ))}
            <div className="heatmap-row heatmap-hours" aria-hidden="true">
              <span className="heatmap-day" />
              {Array.from({ length: 24 }, (_, hour) => (
                <span key={hour}>{hour % 6 === 0 ? hourName(hour) : ''}</span>
              ))}
            </div>
          </div>
          <div className="heatmap-scale" aria-hidden="true">
            <span>Fewer</span>
            <i className="none" />
            {STEPS.map((color) => (
              <i key={color} style={{ background: color }} />
            ))}
            <span>More{top > 0 && ` (up to ${top.toLocaleString('en-IN')} an hour)`}</span>
          </div>
        </>
      )}
    </div>
  )
}

// The same numbers for someone who cannot see the colours: each day's total
// and its busiest hour.
function DayTable({ counts }: HeatmapProps) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Entries</th>
            <th>Busiest hour</th>
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day) => {
            const row = counts[day]
            const sum = row.reduce((a, b) => a + b, 0)
            const peak = row.indexOf(Math.max(...row))
            return (
              <tr key={day}>
                <td className="strong">{DAY_NAMES[day]}</td>
                <td>{sum.toLocaleString('en-IN')}</td>
                <td>{sum === 0 ? '' : `${hours(peak)} (${row[peak].toLocaleString('en-IN')})`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default Heatmap
