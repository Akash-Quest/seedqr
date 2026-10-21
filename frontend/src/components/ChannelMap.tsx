import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useApi } from '../data/api'
import { BIHAR } from '../data/biharMap'
import type { MapDistrict } from '../data/biharMap'
import { districtsOf } from '../data/districts'
import { reducedMotion } from '../data/motion'
import { cropSeries } from '../data/series'
import { titleCase } from '../data/text'
import type { ChannelList, CropCounts } from '../data/types'
import CountUp from './CountUp'
import { ChevronLeftIcon, CloseIcon, MapIcon, SearchIcon } from './Icons'

// Entries per district: one hue, light to dark. A district with none is a
// step off the background, not white.
const STEPS = ['#cde2fb', '#9ec5f4', '#5598e7', '#256abf', '#104281']
const NONE = '#e9edf3'

type View = [x: number, y: number, width: number, height: number]
const WHOLE: View = [0, 0, BIHAR.width, BIHAR.height]

type Channel = {
  name: string
  // The name with capital first letters, and its organisation part alone.
  label: string
  short: string
  district: string | null
  counts: CropCounts
  entries: number
  x: number
  y: number
}

type Area = {
  shape: MapDistrict
  path: string
  entries: number
  channels: Channel[]
  // Which step of STEPS it is drawn in, or -1 for none.
  level: number
}

function number(n: number): string {
  return n.toLocaleString('en-IN')
}

function pathOf(rings: number[][]): string {
  return rings
    .map((ring) => {
      let d = ''
      for (let i = 0; i < ring.length; i += 2) d += `${i ? 'L' : 'M'}${ring[i]} ${ring[i + 1]}`
      return `${d}Z`
    })
    .join('')
}

function inside(x: number, y: number, ring: number[]): boolean {
  let hit = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

// The same run of numbers for the same text, so a channel keeps its spot.
function seeded(text: string): () => number {
  let h = 1779033703 ^ text.length
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

// Where each of a district's channels is drawn. Only the district is known,
// so the spot inside it is made up: inside the district, as far from the
// other channels as a few tries allow, and the same every time.
function spread(shape: MapDistrict, names: string[]): Map<string, [number, number]> {
  const [x0, y0, x1, y1] = shape.box
  const spots = new Map<string, [number, number]>()
  const taken: [number, number][] = []
  for (const name of [...names].sort()) {
    const random = seeded(name)
    let best: [number, number] | null = null
    let far = -1
    for (let tries = 0, found = 0; tries < 120 && found < 14; tries++) {
      const x = x0 + random() * (x1 - x0)
      const y = y0 + random() * (y1 - y0)
      if (!shape.rings.some((ring) => inside(x, y, ring))) continue
      found++
      const gap = taken.length ? Math.min(...taken.map(([tx, ty]) => Math.hypot(x - tx, y - ty))) : 0
      if (gap > far) {
        far = gap
        best = [x, y]
      }
    }
    const spot = best ?? [shape.label[0], shape.label[1]]
    taken.push(spot)
    spots.set(name, spot)
  }
  return spots
}

// The view that shows a district whole, with room around it, in the map's
// own proportions.
function framing(box: number[]): View {
  const [x0, y0, x1, y1] = box
  let width = Math.max((x1 - x0) * 1.35, 130)
  let height = Math.max((y1 - y0) * 1.35, 95)
  const aspect = BIHAR.width / BIHAR.height
  if (width / height > aspect) height = width / aspect
  else width = height * aspect
  return [(x0 + x1) / 2 - width / 2, (y0 + y1) / 2 - height / 2, width, height]
}

type Tip = { kind: 'channel' | 'district'; id: string; x: number; y: number }

type ChannelMapProps = {
  // What to ask the server for: the dashboard's period (see Channels.tsx).
  path: string
  // The period's name, as the dashboard shows it.
  period: string
  onClose: () => void
}

// Every distribution channel on a map of Bihar: districts shaded by how many
// entries their channels have, and each channel a dot sized by its entries.
function ChannelMap({ path, period, onClose }: ChannelMapProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const { data, error } = useApi<ChannelList>(path)
  const [view, setView] = useState<View>(WHOLE)
  const shownView = useRef<View>(WHOLE)
  const flight = useRef(0)
  const [size, setSize] = useState({ width: 800, height: 584 })
  const [chosen, setChosen] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const [query, setQuery] = useState('')
  const [allUnplaced, setAllUnplaced] = useState(false)

  useEffect(() => {
    const box = dialog.current
    if (box && !box.open) box.showModal()
    return () => cancelAnimationFrame(flight.current)
  }, [])

  // The map's size on screen, to keep dots and names the same size in
  // pixels whatever the zoom.
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const crops = useMemo(() => cropSeries(data?.series ?? []), [data])

  // Every channel with its district and spot, and every district's totals.
  const { areas, channels, unplaced, busiest } = useMemo(() => {
    const list = data?.channels ?? []
    const districts = districtsOf(list.map((channel) => channel.name))
    const channels: Channel[] = list.map((channel) => {
      const label = channel.name === 'Not given' ? channel.name : titleCase(channel.name)
      return {
        name: channel.name,
        label,
        short: label.split(/\s*[-–]\s*/)[0].slice(0, 34),
        district: districts.get(channel.name) ?? null,
        counts: channel.counts,
        entries: Object.values(channel.counts).reduce((a, b) => a + b, 0),
        x: 0,
        y: 0,
      }
    })
    const areas: Area[] = BIHAR.districts.map((shape) => {
      const mine = channels.filter((channel) => channel.district === shape.name)
      const spots = spread(shape, mine.map((channel) => channel.name))
      for (const channel of mine) [channel.x, channel.y] = spots.get(channel.name)!
      return {
        shape,
        path: pathOf(shape.rings),
        entries: mine.reduce((sum, channel) => sum + channel.entries, 0),
        channels: mine.sort((a, b) => b.entries - a.entries),
        level: -1,
      }
    })
    const top = Math.max(1, ...areas.map((area) => area.entries))
    for (const area of areas) {
      area.level = area.entries ? Math.min(STEPS.length - 1, Math.floor(Math.sqrt(area.entries / top) * STEPS.length)) : -1
    }
    const placed = channels.filter((channel) => channel.district).sort((a, b) => b.entries - a.entries)
    return {
      areas,
      channels: placed,
      unplaced: channels.filter((channel) => !channel.district).sort((a, b) => b.entries - a.entries),
      busiest: Math.max(1, ...placed.map((channel) => channel.entries)),
    }
  }, [data])

  const byName = useMemo(() => new Map(areas.map((area) => [area.shape.name, area])), [areas])
  const ranked = useMemo(() => areas.filter((area) => area.entries > 0).sort((a, b) => b.entries - a.entries), [areas])
  const placedEntries = channels.reduce((sum, channel) => sum + channel.entries, 0)
  const area = chosen ? byName.get(chosen) : undefined

  // How many map units one pixel is, now; the map is centred in its box.
  const units = Math.max(view[2] / size.width, view[3] / size.height)
  const offset = [(size.width - view[2] / units) / 2, (size.height - view[3] / units) / 2]
  const zoom = BIHAR.width / view[2]
  const toScreen = (x: number, y: number) => [offset[0] + (x - view[0]) / units, offset[1] + (y - view[1]) / units]
  // Dots a little smaller on a narrow screen, where the map is small, and a
  // little bigger zoomed in, where there is room.
  const fit = Math.min(1, Math.max(0.55, size.width / 900))
  const radius = (entries: number) =>
    (3 + 14 * Math.sqrt(entries / busiest)) * fit * Math.min(1.7, 1 + (zoom - 1) * 0.12) * units

  function flyTo(target: View) {
    cancelAnimationFrame(flight.current)
    if (reducedMotion()) {
      shownView.current = target
      setView(target)
      return
    }
    const from = shownView.current
    // The first frame's time is the start.
    let began = -1
    const step = (now: number) => {
      if (began < 0) began = now
      const t = Math.min(1, (now - began) / 750)
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const next = from.map((value, i) => value + (target[i] - value) * eased) as View
      shownView.current = next
      setView(next)
      if (t < 1) flight.current = requestAnimationFrame(step)
    }
    flight.current = requestAnimationFrame(step)
  }

  function choose(name: string | null) {
    setChosen(name)
    setTip(null)
    const target = name ? byName.get(name) : undefined
    flyTo(target ? framing(target.shape.box) : WHOLE)
  }

  function pick(channel: Channel) {
    setPicked(channel.name)
    setQuery('')
    if (channel.district && channel.district !== chosen) choose(channel.district)
  }

  function pointAt(event: ReactPointerEvent, kind: Tip['kind'], id: string) {
    const box = stage.current?.getBoundingClientRect()
    if (!box) return
    setTip({ kind, id, x: event.clientX - box.left, y: event.clientY - box.top })
  }

  // The tooltip shown: what the pointer is on, or else the channel picked
  // from the list, at its dot.
  const pickedChannel = picked ? channels.find((channel) => channel.name === picked) : undefined
  const pickedAt = pickedChannel ? toScreen(pickedChannel.x, pickedChannel.y) : null
  const shownTip: Tip | null =
    tip ?? (pickedChannel && pickedAt ? { kind: 'channel', id: pickedChannel.name, x: pickedAt[0], y: pickedAt[1] } : null)

  const needle = query.trim().toLowerCase()
  const found = needle
    ? [...channels, ...unplaced].filter((channel) => channel.name.toLowerCase().includes(needle)).slice(0, 60)
    : []
  // Names on the map: the busiest districts when all of Bihar shows, the
  // chosen one and its busiest channels when zoomed in.
  const named = new Set(chosen ? [chosen] : ranked.slice(0, 7).map((one) => one.shape.name))
  // Three dot sizes for the key: the busiest channel, a quarter and a
  // twenty-fifth of it, each shown once.
  const sizes = [...new Set([busiest, Math.round(busiest / 4), Math.round(busiest / 25)])].filter((n) => n > 0)

  return (
    <dialog
      ref={dialog}
      className="map-dialog"
      aria-label="Distribution channels on a map of Bihar"
      onCancel={(event) => {
        // Esc first steps back out of a district, then closes.
        if (chosen) {
          event.preventDefault()
          choose(null)
        } else onClose()
      }}
      onClose={onClose}
    >
      <div className="map-shell">
        <header className="map-head">
          <span className="map-head-icon" aria-hidden="true">
            <MapIcon />
          </span>
          <div className="map-title">
            <h2>Channels across Bihar</h2>
            <p>
              Farmer entries by distribution channel, {period}
            </p>
          </div>
          {data && (
            <dl className="map-figures">
              <div>
                <dt>Entries on the map</dt>
                <dd>
                  <CountUp value={placedEntries} />
                </dd>
              </div>
              <div>
                <dt>Channels</dt>
                <dd>
                  <CountUp value={channels.length} />
                </dd>
              </div>
              <div>
                <dt>Districts reached</dt>
                <dd>
                  <CountUp value={ranked.length} />
                </dd>
              </div>
            </dl>
          )}
          <button type="button" className="icon-button map-close" aria-label="Close the map" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="map-body">
          <div
            className={`map-stage${data ? '' : ' waiting'}`}
            ref={stage}
            onPointerLeave={() => setTip(null)}
          >
            <svg
              viewBox={view.join(' ')}
              role="img"
              aria-label={
                ranked[0]
                  ? `Map of Bihar. ${number(channels.length)} channels in ${ranked.length} districts. Busiest district: ${ranked[0].shape.name}, ${number(ranked[0].entries)} entries.`
                  : 'Map of Bihar'
              }
            >
              <rect
                className="map-sea"
                x={-BIHAR.width}
                y={-BIHAR.height}
                width={BIHAR.width * 3}
                height={BIHAR.height * 3}
                onClick={() => {
                  setPicked(null)
                  if (chosen) choose(null)
                }}
              />
              <g className="map-districts">
                {areas.map((one, index) => (
                  <path
                    key={one.shape.name}
                    d={one.path}
                    className={[
                      'map-district',
                      chosen === one.shape.name ? 'chosen' : '',
                      chosen && chosen !== one.shape.name ? 'faded' : '',
                      tip?.kind === 'district' && tip.id === one.shape.name ? 'hover' : '',
                    ].join(' ')}
                    style={{
                      fill: one.level < 0 ? NONE : STEPS[one.level],
                      animationDelay: `${(index % 12) * 35 + Math.floor(one.shape.label[0] / 60) * 20}ms`,
                    }}
                    onPointerMove={(event) => pointAt(event, 'district', one.shape.name)}
                    onClick={() => {
                      setPicked(null)
                      choose(chosen === one.shape.name ? null : one.shape.name)
                    }}
                  />
                ))}
              </g>

              <g className="map-dots">
                {channels.map((channel, rank) => {
                  const r = radius(channel.entries)
                  const on = picked === channel.name || (tip?.kind === 'channel' && tip.id === channel.name)
                  return (
                    <g key={channel.name}>
                      {rank < 3 && !chosen && (
                        <circle
                          className="map-pulse"
                          cx={channel.x}
                          cy={channel.y}
                          r={r}
                          style={{ animationDelay: `${1200 + rank * 500}ms` }}
                        />
                      )}
                      <circle
                        className={`map-dot${on ? ' on' : ''}${chosen && chosen !== channel.district ? ' faded' : ''}`}
                        cx={channel.x}
                        cy={channel.y}
                        r={on ? r * 1.35 : r}
                        style={{ animationDelay: `${450 + Math.min(rank, 120) * 7}ms` }}
                        onPointerMove={(event) => pointAt(event, 'channel', channel.name)}
                        onClick={(event) => {
                          event.stopPropagation()
                          pick(channel)
                        }}
                      />
                    </g>
                  )
                })}
              </g>

              <g className="map-labels" aria-hidden="true" style={{ fontSize: 12 * units }}>
                {areas
                  .filter((one) => named.has(one.shape.name) || (tip?.kind === 'district' && tip.id === one.shape.name))
                  .map((one) => (
                    <text
                      key={one.shape.name}
                      x={one.shape.label[0]}
                      y={one.shape.label[1]}
                      className={chosen === one.shape.name ? 'big' : ''}
                      style={chosen === one.shape.name ? { fontSize: 15 * units } : undefined}
                    >
                      {one.shape.name}
                    </text>
                  ))}
                {area?.channels.slice(0, 6).map((channel) => (
                  <text
                    key={channel.name}
                    className="channel-name"
                    x={channel.x + radius(channel.entries) + 4 * units}
                    y={channel.y + 4 * units}
                    style={{ fontSize: 11 * units }}
                  >
                    {channel.short}
                  </text>
                ))}
              </g>
            </svg>

            {!data && !error && <p className="map-wait">Placing channels on the map…</p>}

            {chosen && (
              <button type="button" className="map-back" onClick={() => choose(null)}>
                <ChevronLeftIcon />
                All of Bihar
              </button>
            )}

            <div className="map-legend" aria-hidden="true">
              <p>Entries per district</p>
              <span className="map-ramp">
                <i style={{ background: NONE }} />
                {STEPS.map((color) => (
                  <i key={color} style={{ background: color }} />
                ))}
              </span>
              <span className="map-ramp-ends">
                <span>None</span>
                <span>More</span>
              </span>
              {data && channels.length > 0 && (
                <div className="map-key-sizes">
                  <p>Each dot is a channel, sized by entries</p>
                  <span className="map-sizes">
                    {sizes.map((n) => {
                      const r = 3 + 14 * Math.sqrt(n / busiest)
                      return (
                        <span key={n}>
                          <i style={{ width: r * 2, height: r * 2 }} />
                          {number(n)}
                        </span>
                      )
                    })}
                  </span>
                </div>
              )}
            </div>

            {shownTip && <MapTip tip={shownTip} byName={byName} channels={channels} crops={crops} whole={placedEntries} />}
          </div>

          <aside className="map-side">
            <label className="map-search">
              <SearchIcon />
              <input
                type="search"
                placeholder="Find a channel"
                aria-label="Find a channel"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            {error ? (
              <p className="problem">{error}</p>
            ) : !data ? (
              <p className="muted">Loading the channels…</p>
            ) : needle ? (
              <>
                <h3>
                  {found.length === 0 ? 'No channel matches' : `${found.length === 60 ? '60+' : found.length} matching`}
                </h3>
                <ol className="map-list">
                  {found.map((channel) => (
                    <li key={channel.name}>
                      <button type="button" disabled={!channel.district} onClick={() => pick(channel)}>
                        <span className="map-row-name">{channel.label}</span>
                        <span className="map-row-note">{channel.district ?? 'Not placed on the map'}</span>
                        <strong>{number(channel.entries)}</strong>
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            ) : area ? (
              <>
                <button type="button" className="link-button map-up" onClick={() => choose(null)}>
                  <ChevronLeftIcon /> All districts
                </button>
                <div className="map-district-head">
                  <h3>{area.shape.name}</h3>
                  <p>
                    <strong>
                      <CountUp value={area.entries} />
                    </strong>{' '}
                    entries from {area.channels.length} {area.channels.length === 1 ? 'channel' : 'channels'}
                    {placedEntries > 0 && `, ${Math.round((area.entries / placedEntries) * 100)}% of the map`}
                  </p>
                </div>
                {area.channels.length === 0 ? (
                  <p className="muted">No channel in this district has entries in this period.</p>
                ) : (
                  <ol className="map-list">
                    {area.channels.map((channel, index) => (
                      <li key={channel.name} style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}>
                        <button
                          type="button"
                          className={picked === channel.name ? 'on' : ''}
                          onClick={() => pick(channel)}
                          onPointerEnter={() => setPicked(channel.name)}
                        >
                          <span className="map-row-name">{channel.label}</span>
                          <strong>{number(channel.entries)}</strong>
                          <span className="map-row-bar">
                            <i style={{ width: `${(channel.entries / area.channels[0].entries) * 100}%` }} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : (
              <>
                <h3>Districts, busiest first</h3>
                <ol className="map-list">
                  {ranked.map((one, index) => (
                    <li key={one.shape.name} style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}>
                      <button type="button" onClick={() => choose(one.shape.name)}>
                        <span className="map-row-name">{one.shape.name}</span>
                        <span className="map-row-note">
                          {one.channels.length} {one.channels.length === 1 ? 'channel' : 'channels'}
                        </span>
                        <strong>{number(one.entries)}</strong>
                        <span className="map-row-bar">
                          <i style={{ width: `${(one.entries / ranked[0].entries) * 100}%` }} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}

            {data && unplaced.length > 0 && !needle && (
              <section className="map-unplaced">
                <button
                  type="button"
                  className="link-button"
                  aria-expanded={allUnplaced}
                  onClick={() => setAllUnplaced(!allUnplaced)}
                >
                  {unplaced.length} {unplaced.length === 1 ? 'channel' : 'channels'} not on the map (
                  {number(unplaced.reduce((sum, channel) => sum + channel.entries, 0))} entries)
                </button>
                {allUnplaced && (
                  <>
                    <p className="muted">Their names do not say which district they are in.</p>
                    <ul>
                      {unplaced.map((channel) => (
                        <li key={channel.name}>
                          <span>{channel.label}</span>
                          <strong>{number(channel.entries)}</strong>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}
            <p className="map-note">
              Each channel sits in the district its name gives. Only the district is
              known, so its spot inside the district is approximate.
            </p>
          </aside>
        </div>
      </div>
    </dialog>
  )
}

type MapTipProps = {
  tip: Tip
  byName: Map<string, Area>
  channels: Channel[]
  crops: ReturnType<typeof cropSeries>
  whole: number
}

// What the pointer is on: a channel with its entries by crop, or a district.
function MapTip({ tip, byName, channels, crops, whole }: MapTipProps) {
  const channel = tip.kind === 'channel' ? channels.find((one) => one.name === tip.id) : undefined
  const area = tip.kind === 'district' ? byName.get(tip.id) : undefined
  if (!channel && !area) return null
  const parts = channel ? crops.split(channel.counts).sort((a, b) => b.value - a.value).slice(0, 3) : []
  return (
    <div className={`map-tip${tip.x > 260 ? ' left' : ''}`} style={{ left: tip.x, top: tip.y }} role="status">
      {channel ? (
        <>
          <strong className="map-tip-value">{number(channel.entries)}</strong> entries
          <span className="map-tip-name">{channel.label}</span>
          <span className="map-tip-note">
            {channel.district}
            {whole > 0 && ` · ${((channel.entries / whole) * 100).toFixed(1)}% of the map`}
          </span>
          {parts.map((part) => (
            <span className="chart-tip-row" key={part.name}>
              <i style={{ background: part.color }} />
              <strong>{number(part.value)}</strong> {part.name}
            </span>
          ))}
        </>
      ) : area ? (
        <>
          <strong className="map-tip-value">{number(area.entries)}</strong> entries
          <span className="map-tip-name">{area.shape.name}</span>
          <span className="map-tip-note">
            {area.channels.length === 0
              ? 'No channels with entries'
              : `${area.channels.length} ${area.channels.length === 1 ? 'channel' : 'channels'} · click to zoom in`}
          </span>
        </>
      ) : null}
    </div>
  )
}

export default ChannelMap
