import { useState } from 'react'
import type { SyntheticEvent } from 'react'
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

// Stand for "All time" and "Custom" where the others give a number of days.
const ALL = 0
const CUSTOM = -1

const RANGES = [
  // Everything since the first entry, however long ago that was.
  { days: ALL, label: 'All time' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  // From one picked day to another.
  { days: CUSTOM, label: 'Custom' },
]

const DAY = 86_400_000
// How many days one chart column may cover. "All time" takes the smallest
// that keeps the chart to about a month's worth of columns.
const COLUMN_DAYS = [1, 7, 30, 90, 365]
const MOST_COLUMNS = 31
// The column sizes that can be picked over the chart.
const STEPS = [
  { size: 1, label: 'Day' },
  { size: 7, label: 'Week' },
  { size: 30, label: 'Month' },
]
// The server refuses a chart of more columns than this.
const MOST_DRAWN = 400

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

// A date box's "2026-07-01" as midnight on that day, and back.
function dayOf(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

function dateValue(time: number): string {
  const date = new Date(time)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
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
  return size === 1
    ? 'day'
    : size === 7
      ? 'week'
      : size === 30
        ? 'month'
        : size === 365
          ? 'year'
          : `${size} days`
}

type Split = (counts: CropCounts) => Part[]

// One column per day, or per week or longer for the wider views. The server
// has already counted the entries for each.
// The last column may be cut farmerhort by `last`, the final day of the period.
function buildColumns(
  counts: CropCounts[],
  start: number,
  last: number,
  size: number,
  split: Split,
): Column[] {
  const count = counts.length
  const every = count <= 7 ? 1 : size === 1 ? 5 : 2
  // Columns longer than a week can reach into another year.
  const label = size > 7 ? dayMonthYear : dayMonth

  return counts.map((column, i) => {
    const from = start + i * size * DAY
    const to = Math.min(from + (size - 1) * DAY, last)
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
  // A column size picked over the chart. Until then it is chosen to fit.
  const [step, setStep] = useState<number | null>(null)
  // The two days shown for "Custom", as the date boxes write them.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // What is in the boxes now. Only "Apply" makes it the days shown, so the
  // server is not asked again at every click in the calendar.
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')
  const draftReady = draftFrom !== '' && draftTo !== '' && draftFrom <= draftTo
  const draftChanged = draftFrom !== from || draftTo !== to
  const custom = days === CUSTOM
  // Both days are there and in the right order.
  const picked = from !== '' && to !== '' && from <= to
  // "All time" is chosen, but what it covers is still being asked. Any
  // answer says when the first and latest entries came in, so a week is
  // asked for.
  const finding = days === ALL && whole === null

  // The last day shown: today, the last day picked, or for "All time" the
  // day of the latest entry, so the chart does not trail off into months
  // with nothing in them.
  const end = custom
    ? picked
      ? dayOf(to)
      : startOfDay(now)
    : days === ALL && whole
      ? whole.last
      : startOfDay(now)
  // How many days to show: the number chosen, every day picked, or for
  // "All time" every day from the first entry to the latest.
  const wanted = custom
    ? picked
      ? Math.round((dayOf(to) - dayOf(from)) / DAY) + 1
      : 7
    : days !== ALL
      ? days
      : whole === null
        ? 7
        : Math.round((whole.last - whole.first) / DAY) + 1
  const fitting =
    days === ALL || custom
      ? (COLUMN_DAYS.find((length) => wanted / length <= MOST_COLUMNS) ?? 365)
      : days > 30
        ? 7
        : 1
  // A size fits when a column is no longer than the period, and there are
  // not too many columns to draw.
  const fits = (length: number) =>
    length <= Math.max(wanted, 1) && Math.ceil(wanted / length) <= MOST_DRAWN
  const steps = STEPS.map((choice) => ({ ...choice, fits: fits(choice.size) }))
  // A picked size that no longer fits the period gives way to the fitting one.
  const size = step !== null && fits(step) ? step : fitting
  // Drawn in whole columns, so the 90 day view covers 91 days. Picked days
  // are kept exactly: the last column is cut short instead.
  const span = custom ? wanted : Math.ceil(wanted / size) * size
  const start = end - (span - 1) * DAY
  const since = encodeURIComponent(new Date(start).toISOString())
  const until = encodeURIComponent(new Date(end + DAY).toISOString())

  const lots = useApi<SeedLot[]>('/lots')
  const stats = useApi<Stats>(`/stats?start=${since}&days=${span}&size=${size}`)
  const latest = useApi<EntryPage>(`/entries?size=5&from=${since}&to=${until}`)

  // How the period is named on the page.
  const period = custom
    ? `${dayMonthYear(start)} to ${dayMonthYear(end)}`
    : days === ALL
      ? 'all time'
      : `last ${days} days`
  const during = custom ? `from ${period}` : days === ALL ? 'in all' : `during the ${period}`

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
    // "Custom" starts on what is showing now, ready to be narrowed down.
    if (next === CUSTOM && !picked) {
      setFrom(dateValue(start))
      setTo(dateValue(end))
      setDraftFrom(dateValue(start))
      setDraftTo(dateValue(end))
    }
    setDays(next)
  }

  function apply(event: SyntheticEvent) {
    event.preventDefault()
    setFrom(draftFrom)
    setTo(draftTo)
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

            {custom && (
              <form className="date-filter custom-dates" onSubmit={apply}>
                <label htmlFor="dashboard-from">From</label>
                <input
                  id="dashboard-from"
                  type="date"
                  value={draftFrom}
                  max={draftTo || undefined}
                  onChange={(e) => setDraftFrom(e.target.value)}
                />
                <label htmlFor="dashboard-to">To</label>
                <input
                  id="dashboard-to"
                  type="date"
                  value={draftTo}
                  min={draftFrom || undefined}
                  onChange={(e) => setDraftTo(e.target.value)}
                />
                <button type="submit" className="compact" disabled={!draftReady || !draftChanged}>
                  Apply
                </button>
                {!draftReady && <span>Pick a From day and a To day on or after it.</span>}
              </form>
            )}

            {ready ? (
              <Overview
                lots={lots.data}
                stats={stats.data}
                latest={latest.data.items}
                start={start}
                end={end}
                size={size}
                steps={steps}
                onStep={setStep}
                allTime={days === ALL}
                length={custom ? span : days}
                period={period}
                during={during}
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
  // Midnight on the first and the last day of the period, and how many
  // days a column covers.
  start: number
  end: number
  size: number
  // The column sizes that can be picked, and what to do when one is.
  steps: { size: number; label: string; fits: boolean }[]
  onStep: (size: number) => void
  allTime: boolean
  // How many days the period has, for comparing with the days before it.
  length: number
  // The period's name ("last 30 days"), and the words for "in it".
  period: string
  during: string
}

function Overview({
  lots,
  stats,
  latest,
  start,
  end,
  size,
  allTime,
  length,
  period,
  during,
}: OverviewProps) {
  const crops = cropSeries(stats.series)
  const cropParts = crops.split(sum(stats.columns))
  const current = total(cropParts)
  // Lots nobody has scanned at all, whatever the period.
  const unused = lots.filter((lot) => !lot.entryCount)
  const first = stats.first ? dayMonthYear(new Date(stats.first).getTime()) : ''
  const last = stats.last ? dayMonthYear(new Date(stats.last).getTime()) : ''
  const channelRows: BarRow[] = stats.channels.map((channel) => ({
    name: channel.name,
    parts: crops.split(channel.counts),
  }))
  const columns = buildColumns(stats.columns, start, end, size, crops.split)

  return (
    <>
      <div className="stats">
        {/* Each tile opens where its number comes from. */}
        <Link className="card stat solid blue" to="/users" title="See the farmer entries">
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
            <Change now={current} before={stats.previous} days={length} />
          )}
        </Link>

        <Link className="card stat solid green" to="/barcode" title="See the seed lots">
          <span className="stat-icon" aria-hidden="true">
            <QrIcon />
          </span>
          {/* For a period: the lots farmers' entries were for in it. Not the
              lots made in it: an import makes its lots on the day of the
              import, long after the entries in it came in. */}
          <p className="stat-label">{allTime ? 'Seed lots' : 'Seed lots with entries'}</p>
          <p className="stat-value">
            {(allTime ? lots.length : stats.lotCount).toLocaleString('en-IN')}
          </p>
          <p className="stat-note">
            {allTime
              ? lots.length === 0
                ? 'none yet'
                : unused.length === 0
                  ? 'every lot has farmer entries'
                  : `${unused.length} with no entries yet`
              : stats.lotCount === 0
                ? 'none in this period'
                : `of ${lots.length.toLocaleString('en-IN')} in all`}
          </p>
        </Link>

        {/* The channels are listed further down this page. */}
        <a className="card stat solid amber" href="#channels" title="See the busiest channels">
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
        </a>
      </div>

      <div className="split wide">
        <section className="card">
          <div className="card-head">
            <h2>
              Farmer entries per {columnName(size)}, by {stats.by}
            </h2>
            <div className="card-head-end">
              <p>
                {current.toLocaleString('en-IN')} {during}
              </p>
              {/* <select
                className="step-select"
                aria-label="One column for each"
                value={size}
                onChange={(e) => onStep(Number(e.target.value))}
              >

                {!steps.some((choice) => choice.size === size) && (
                  <option value={size}>
                    {columnName(size).charAt(0).toUpperCase() + columnName(size).slice(1)}
                  </option>
                )}
                {steps.map((choice) => (
                  <option key={choice.size} value={choice.size} disabled={!choice.fits}>
                    {choice.label}
                  </option>
                ))}
              </select> */}
            </div>
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
        <section className="card" id="channels">
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
                {allTime ? 'Nothing has come in yet' : `Nothing came in ${during}`}
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
