import { useState } from 'react'
import { Link } from 'react-router-dom'
import BarList from '../components/BarList'
import type { BarRow } from '../components/BarList'
import ColumnChart from '../components/ColumnChart'
import type { Column } from '../components/ColumnChart'
import Donut from '../components/Donut'
import { PlusIcon } from '../components/Icons'
import PageHeader from '../components/PageHeader'
import { canEdit, useApi } from '../data/api'
import { cropSeries, sum, total } from '../data/series'
import type { Part, Series } from '../data/series'
import { formatDateTime } from '../data/types'
import type { CropCounts, EntryPage, SeedLot, Stats } from '../data/types'

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
]

const DAY = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function dayMonth(time: number): string {
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

type Split = (counts: CropCounts) => Part[]

// One column per day, or per week for the 90 day view. The server has
// already counted the entries for each.
function buildColumns(counts: CropCounts[], start: number, size: number, split: Split): Column[] {
  const count = counts.length
  const every = count === 7 ? 1 : size === 1 ? 5 : 2

  return counts.map((column, i) => {
    const from = start + i * size * DAY
    const to = from + (size - 1) * DAY
    const weekday = new Date(from).toLocaleDateString('en-GB', { weekday: 'short' })
    return {
      key: String(from),
      // Counted back from the newest column so "today" always has a label.
      tick: (count - 1 - i) % every === 0 ? dayMonth(from) : '',
      name: size === 1 ? `${weekday} ${dayMonth(from)}` : `${dayMonth(from)} to ${dayMonth(to)}`,
      parts: split(column),
    }
  })
}

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="legend">
      {series.map((item) => (
        <li key={item.name}>
          <i style={{ background: item.color }} />
          <span>{item.name}</span>
        </li>
      ))}
    </ul>
  )
}

function Dashboard() {
  const [now] = useState(() => new Date())
  const [days, setDays] = useState(7)

  // The 90 day view is drawn in whole weeks, so it covers 91 days.
  const size = days > 30 ? 7 : 1
  const span = Math.ceil(days / size) * size
  const start = startOfDay(now) - (span - 1) * DAY
  const since = encodeURIComponent(new Date(start).toISOString())

  const lots = useApi<SeedLot[]>('/lots')
  const stats = useApi<Stats>(`/stats?start=${since}&days=${span}&size=${size}`)
  const latest = useApi<EntryPage>(`/entries?size=5&from=${since}`)

  const today = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const error = lots.error || stats.error || latest.error
  // Wait for the numbers of the period now chosen, not the one before.
  const ready = lots.data && stats.data && latest.data && stats.fresh && latest.fresh

  return (
    <>
      <PageHeader title="Dashboard" subtitle={today}>
        {canEdit() && (
          <Link className="button" to="/barcode?new=1">
            <PlusIcon />
            Add a seed lot
          </Link>
        )}
      </PageHeader>

      <div className="page">
        {error ? (
          <p className="problem">{error}</p>
        ) : !lots.data || !stats.data || !latest.data ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="range" role="group" aria-label="Time period">
              {RANGES.map((range) => (
                <button
                  key={range.days}
                  type="button"
                  className={range.days === days ? 'on' : ''}
                  aria-pressed={range.days === days}
                  onClick={() => setDays(range.days)}
                >
                  {range.label}
                </button>
              ))}
            </div>

            {ready ? (
              <Overview
                lots={lots.data}
                stats={stats.data}
                latest={latest.data.items}
                start={start}
                size={size}
                days={days}
              />
            ) : (
              <p className="muted">Loading…</p>
            )}
          </>
        )}
      </div>
    </>
  )
}

type OverviewProps = {
  lots: SeedLot[]
  stats: Stats
  // The newest few entries of the period.
  latest: EntryPage['items']
  // Midnight at the start of the period, and how many days a column covers.
  start: number
  size: number
  days: number
}

function Overview({ lots, stats, latest, start, size, days }: OverviewProps) {
  const crops = cropSeries(stats.series)
  const cropParts = crops.split(sum(stats.columns))
  const current = total(cropParts)
  const newLots = lots.filter((lot) => new Date(lot.createdAt).getTime() >= start)
  const unused = newLots.filter((lot) => !lot.entryCount)
  const period = `last ${days} days`
  const channelRows: BarRow[] = stats.channels.map((channel) => ({
    name: channel.name,
    parts: crops.split(channel.counts),
  }))

  return (
    <>
      <div className="stats">
        <div className="card stat">
          <p className="stat-label">Farmer entries</p>
          <p className="stat-value">{current.toLocaleString('en-IN')}</p>
          <Change now={current} before={stats.previous} days={days} />
        </div>
        
        <div className="card stat">
          <p className="stat-label">Seed lots added</p>
          <p className="stat-value">{newLots.length}</p>
          <p className="stat-note">
            {newLots.length === 0
              ? 'none in this period'
              : unused.length === 0
                ? 'all scanned at least once'
                : `${unused.length} not scanned yet`}
          </p>
        </div>
        
      </div>

      <div className="split wide">
        <section className="card">
          <div className="card-head">
            <h2>Farmer entries {days > 30 ? 'per week' : 'per day'}, by crop</h2>
            <p>{current.toLocaleString('en-IN')} in the {period}</p>
          </div>
          <div className="card-body">
            <Legend series={cropParts} />
            <ColumnChart
              columns={buildColumns(stats.columns, start, size, crops.split)}
              unit={['entry', 'entries']}
            />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Share by crop</h2>
            <p>{period}</p>
          </div>
          {current === 0 ? (
            <p className="empty">No entries in this period.</p>
          ) : (
            <div className="card-body">
              <Donut parts={cropParts} unit={['entry', 'entries']} />
            </div>
          )}
        </section>
      </div>

      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>Busiest distribution channels</h2>
            <p>{period}</p>
          </div>
          {current === 0 ? (
            <p className="empty">No entries in this period.</p>
          ) : (
            <div className="card-body">
              <BarList rows={channelRows} />
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Latest farmer entries</h2>
            {current > 0 && <Link to="/users">See all</Link>}
          </div>
          {current === 0 ? (
            <p className="empty">
              <strong>Nothing came in during the {period}</strong>
              {lots.length === 0
                ? 'Add a seed lot and print its QR code to get started.'
                : 'Entries appear here when a farmer scans a bag and submits the form.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Farmer</th>
                    <th>Crop</th>
                    <th>Quantity</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.map((e) => (
                    <tr key={e.id}>
                      <td className="strong">{e.farmerName}</td>
                      <td>{e.lot?.crop}</td>
                      <td>{e.quantity}</td>
                      <td>{formatDateTime(e.receivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {unused.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>New lots nobody has scanned yet</h2>
            <p>{unused.length} waiting</p>
          </div>
          <ul className="rows">
            {unused.slice(0, 5).map((lot) => (
              <li key={lot.id}>
                <span>
                  <strong>
                    {lot.crop}, {lot.variety}
                  </strong>{' '}
                  <span className="muted">batch {lot.batchNo}</span>
                </span>
                <Link to={`/barcode?lot=${lot.id}`}>Show QR code</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

// How this period compares with the one just before it.
function Change({ now, before, days }: { now: number; before: number; days: number }) {
  const difference = now - before
  if (difference === 0) {
    return <p className="stat-note">same as the {days} days before</p>
  }
  return (
    <p className="stat-note">
      <span className={difference > 0 ? 'up' : 'down'} aria-hidden="true">
        {difference > 0 ? '▲' : '▼'}
      </span>{' '}
      {Math.abs(difference).toLocaleString('en-IN')} {difference > 0 ? 'more' : 'fewer'} than the {days} days
      before
    </p>
  )
}

export default Dashboard
