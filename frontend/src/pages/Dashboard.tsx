import { useState } from 'react'
import { Link } from 'react-router-dom'
import BarList from '../components/BarList'
import type { BarRow } from '../components/BarList'
import ColumnChart from '../components/ColumnChart'
import type { Column } from '../components/ColumnChart'
import Donut from '../components/Donut'
import { InboxIcon, PlusIcon, QrIcon, UsersIcon } from '../components/Icons'
import PageHeader from '../components/PageHeader'
import { canEdit, useApi } from '../data/api'
import { cropSeries, sum, total } from '../data/series'
import type { Part, Series } from '../data/series'
import { formatDateTime } from '../data/types'
import type { CropCounts, EntryPage, SeedLot, Stats } from '../data/types'

// Stands for "All time" where the others give a number of days.
const ALL = 0

const RANGES = [
  // Everything since the first entry, however long ago that was.
  { days: ALL, label: 'All time' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
]

const DAY = 86_400_000
// How many days one chart column may cover. "All time" takes the smallest
// that keeps the chart to about a month's worth of columns.
const COLUMN_DAYS = [1, 7, 30, 90, 365]
const MOST_COLUMNS = 31

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function dayMonth(time: number): string {
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function dayMonthYear(time: number): string {
  return new Date(time).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// What one column of the chart covers, as in "Farmer entries per week".
function columnName(size: number): string {
  return size === 1 ? 'day' : size === 7 ? 'week' : size === 365 ? 'year' : `${size} days`
}

type Split = (counts: CropCounts) => Part[]

// One column per day, or per week or longer for the wider views. The server
// has already counted the entries for each.
function buildColumns(counts: CropCounts[], start: number, size: number, split: Split): Column[] {
  const count = counts.length
  const every = count <= 7 ? 1 : size === 1 ? 5 : 2
  // Columns longer than a week can reach into another year.
  const label = size > 7 ? dayMonthYear : dayMonth

  return counts.map((column, i) => {
    const from = start + i * size * DAY
    const to = from + (size - 1) * DAY
    const weekday = new Date(from).toLocaleDateString('en-GB', { weekday: 'short' })
    return {
      key: String(from),
      // Counted back from the newest column so "today" always has a label.
      tick: (count - 1 - i) % every === 0 ? dayMonth(from) : '',
      name: size === 1 ? `${weekday} ${dayMonth(from)}` : `${label(from)} to ${label(to)}`,
      parts: split(column),
    }
  })
}

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="legend below">
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
  // The dashboard opens on everything there is.
  const [days, setDays] = useState(ALL)
  // For "All time": midnight on the days of the very first and the latest
  // entry. Not known until the server has answered once.
  const [whole, setWhole] = useState<{ first: number; last: number } | null>(null)
  // "All time" is chosen, but what it covers is still being asked. Any
  // answer says when the first and latest entries came in, so a week is
  // asked for.
  const finding = days === ALL && whole === null

  // The last day shown: today, or for "All time" the day of the latest
  // entry, so the chart does not trail off into months with nothing in them.
  const end = days === ALL && whole ? whole.last : startOfDay(now)
  // How many days to show: the number chosen, or for "All time" every day
  // from the first entry to the latest.
  const wanted =
    days !== ALL ? days : whole === null ? 7 : Math.round((whole.last - whole.first) / DAY) + 1
  const size =
    days === ALL
      ? (COLUMN_DAYS.find((length) => wanted / length <= MOST_COLUMNS) ?? 365)
      : days > 30
        ? 7
        : 1
  // Drawn in whole columns, so the 90 day view covers 91 days.
  const span = Math.ceil(wanted / size) * size
  const start = end - (span - 1) * DAY
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
  const ready =
    lots.data && stats.data && latest.data && stats.fresh && latest.fresh && !finding

  // Every answer says when the first and latest entries came in. With none
  // yet, "All time" is simply the last week.
  // Set while drawing, not in an effect: React then draws again at once with
  // the real period, and never shows the week that was only asked for this.
  const answer = stats.data
  if (finding && answer) {
    setWhole(
      answer.first && answer.last
        ? {
            first: startOfDay(new Date(answer.first)),
            last: startOfDay(new Date(answer.last)),
          }
        : { first: startOfDay(now) - 6 * DAY, last: startOfDay(now) },
    )
  }

  function choose(next: number) {
    // Looked up afresh each time, in case entries were imported since.
    if (next === ALL) setWhole(null)
    setDays(next)
  }

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
                  onClick={() => choose(range.days)}
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
  const allTime = days === ALL
  const newLots = allTime
    ? lots
    : lots.filter((lot) => new Date(lot.createdAt).getTime() >= start)
  const unused = newLots.filter((lot) => !lot.entryCount)
  const period = allTime ? 'all time' : `last ${days} days`
  const first = stats.first ? dayMonthYear(new Date(stats.first).getTime()) : ''
  const last = stats.last ? dayMonthYear(new Date(stats.last).getTime()) : ''
  const channelRows: BarRow[] = stats.channels.map((channel) => ({
    name: channel.name,
    parts: crops.split(channel.counts),
  }))
  const columns = buildColumns(stats.columns, start, size, crops.split)

  return (
    <>
      <div className="stats">
        <div className="card stat solid blue">
          <span className="stat-icon" aria-hidden="true">
            <InboxIcon />
          </span>
          <p className="stat-label">Farmer entries</p>
          <p className="stat-value">{current.toLocaleString('en-IN')}</p>
          {allTime ? (
            // Nothing came before all time, so there is nothing to compare.
            <p className="stat-note">
              {first ? (first === last ? `on ${first}` : `${first} to ${last}`) : 'none yet'}
            </p>
          ) : (
            <Change now={current} before={stats.previous} days={days} />
          )}
        </div>

        <div className="card stat solid green">
          <span className="stat-icon" aria-hidden="true">
            <QrIcon />
          </span>
          <p className="stat-label">{allTime ? 'Seed lots' : 'Seed lots added'}</p>
          <p className="stat-value">{newLots.length.toLocaleString('en-IN')}</p>
          <p className="stat-note">
            {newLots.length === 0
              ? 'none in this period'
              : unused.length === 0
                ? 'every lot has farmer entries'
                : `${unused.length} with no entries yet`}
          </p>
        </div>

        <div className="card stat solid amber">
          <span className="stat-icon" aria-hidden="true">
            <UsersIcon />
          </span>
          <p className="stat-label">Distribution channels</p>
          <p className="stat-value">{stats.channelCount.toLocaleString('en-IN')}</p>
          {/* A channel's name is too long to fit here; the list of the
              busiest channels further down has the names. */}
          <p className="stat-note">
            {channelRows[0]
              ? `busiest one has ${total(channelRows[0].parts).toLocaleString('en-IN')} entries`
              : 'none in this period'}
          </p>
        </div>
      </div>

      <div className="split wide">
        <section className="card">
          <div className="card-head">
            <h2>
              Farmer entries per {columnName(size)}, by {stats.by}
            </h2>
            <p>
              {current.toLocaleString('en-IN')} {allTime ? 'in all' : `in the ${period}`}
            </p>
          </div>
          <div className="card-body">
            <ColumnChart
              columns={columns}
              unit={['entry', 'entries']}
            />
            {/* Under the chart, so the bars come first. */}
            <Legend series={cropParts} />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Share by {stats.by}</h2>
            <p>{period}</p>
          </div>
          {current === 0 ? (
            <p className="empty">No entries in this period.</p>
          ) : (
            <div className="card-body">
              <Donut
                parts={cropParts}
                unit={['entry', 'entries']}
                label={`Share of farmer entries by ${stats.by}`}
              />
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
              <BarList rows={channelRows} whole={current} />
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
              <strong>
                {allTime ? 'Nothing has come in yet' : `Nothing came in during the ${period}`}
              </strong>
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
