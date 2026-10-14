import { Fragment, useState } from 'react'
import { total } from '../data/series'
import { ChevronRightIcon } from './Icons'
import type { Part } from '../data/series'

const RADIUS = 42
const AROUND = 2 * Math.PI * RADIUS
// Space left between slices, in the same units as the drawing.
const GAP = 1.6

type DonutProps = {
  parts: Part[]
  // Word for what is being counted, shown in the middle: "entries".
  unit: [singular: string, plural: string]
  // What the picture shows, for someone who cannot see it.
  label: string
}

// A ring split by share, with every name, number and percentage listed
// beside it so the colours are never the only way to read it.
function Donut({ parts, unit, label }: DonutProps) {
  const [active, setActive] = useState<string | null>(null)
  // Whether the list under "Other" is open.
  const [open, setOpen] = useState(false)
  const sum = total(parts)
  const shown = parts.find((part) => part.name === active)
  const share = (value: number) => Math.round((value / sum) * 100)
  const middle = (shown ? shown.value : sum).toLocaleString('en-IN')
  // A long number is written smaller, so it stays inside the ring.
  const size = middle.length <= 5 ? 20 : middle.length <= 7 ? 15 : 12

  // Running start position of each slice along the ring.
  const starts = parts.map((_, index) =>
    parts.slice(0, index).reduce((length, part) => length + (part.value / sum) * AROUND, 0),
  )

  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={label}>
        {parts.map((part, index) => {
          const length = (part.value / sum) * AROUND
          const drawn = parts.length > 1 ? Math.max(length - GAP, 0.5) : length
          return (
            <circle
              key={part.name}
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              stroke={part.color}
              strokeWidth={active === part.name ? 18 : 15}
              strokeDasharray={`${drawn} ${AROUND - drawn}`}
              strokeDashoffset={-starts[index]}
              transform="rotate(-90 60 60)"
              tabIndex={0}
              aria-label={`${part.name}: ${part.value}, ${share(part.value)}%`}
              onPointerEnter={() => setActive(part.name)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(part.name)}
              onBlur={() => setActive(null)}
              onClick={part.members?.length ? () => setOpen(!open) : undefined}
            />
          )
        })}
        <text
          x="60"
          y="59"
          textAnchor="middle"
          className="donut-value"
          style={{ fontSize: `${size}px` }}
        >
          {middle}
        </text>
        <text
          x="60"
          y="72"
          textAnchor="middle"
          className="donut-label"
          // A longer name is written smaller, so it does not touch the ring.
          style={shown && shown.name.length > 9 ? { fontSize: '6.5px' } : undefined}
        >
          {/* A very long name would still run over; the list below has it in full. */}
          {shown
            ? shown.name.length > 16
              ? `${shown.name.slice(0, 15)}…`
              : shown.name
            : sum === 1
              ? unit[0]
              : unit[1]}
        </text>
      </svg>

      <ul className="legend stacked">
        {parts.map((part) => (
          <Fragment key={part.name}>
            <li
              className={active === part.name ? 'on' : ''}
              onPointerEnter={() => setActive(part.name)}
              onPointerLeave={() => setActive(null)}
            >
              <i style={{ background: part.color }} />
              {part.members?.length ? (
                // "Other" opens to list what it is made of.
                <button
                  type="button"
                  className="legend-open"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}
                >
                  {part.name}
                  <ChevronRightIcon />
                </button>
              ) : (
                <span>{part.name}</span>
              )}
              <strong>{part.value.toLocaleString('en-IN')}</strong>
              <span className="muted">{share(part.value)}%</span>
            </li>
            {open &&
              part.members?.map((member) => (
                <li key={`${part.name}/${member.name}`} className="member">
                  <span>{member.name}</span>
                  <strong>{member.value.toLocaleString('en-IN')}</strong>
                  <span className="muted">{share(member.value)}%</span>
                </li>
              ))}
          </Fragment>
        ))}
      </ul>
    </div>
  )
}

export default Donut
