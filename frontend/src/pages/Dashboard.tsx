import { useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { Link } from 'react-router-dom'
import BarList from '../components/BarList'
import type { BarRow } from '../components/BarList'
import ColumnChart from '../components/ColumnChart'
import type { Column } from '../components/ColumnChart'
import CountUp from '../components/CountUp'
import Donut from '../components/Donut'
import Heatmap from '../components/Heatmap'
import {
  AlertIcon,
  InboxIcon,
  PhoneIcon,
  PlusIcon,
  QrIcon,
  RefreshIcon,
  SparkIcon,
  TrendDownIcon,
  TrendUpIcon,
  UsersIcon,
} from '../components/Icons'
import PageHeader from '../components/PageHeader'
import { PageSkeleton } from '../components/Skeleton'
import Sparkline from '../components/Sparkline'
import { canEdit, useApi } from '../data/api'
import { insights } from '../data/insights'
import type { Insight } from '../data/insights'
import { ago, useNow } from '../data/motion'
import { cropSeries, sum, total } from '../data/series'
import type { Part, Series } from '../data/series'
import { toast } from '../data/toast'
import { formatDateTime } from '../data/types'
import type { CropCounts, Stats } from '../data/types'

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

// While "Live" is on, the numbers are asked for again this often. The
// server keeps its answer until something changes, so this costs little.
const LIVE_EVERY = 30_000
const LIVE_KEY = 'seedcode.live'

function liveChosen(): boolean {
  try {
    return localStorage.getItem(LIVE_KEY) !== 'off'
  } catch {
    return true
  }
}

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

function columnTotal(column: CropCounts): number {
  return Object.values(column).reduce((a, b) => a + b, 0)
}

type Split = (counts: CropCounts) => Part[]

// One column per day, or per week or longer for the wider views. The server
// has already counted the entries for each.
// The last column may be cut short by `last`, the final day of the period.
function buildColumns(
  counts: CropCounts[],
  start: number,
  last: number,
  size: number,
  split: Split,
): Column[] {
  const count = counts.length
  // About seven labels, however many columns, so they never run together.
  const every = count <= 7 ? 1 : Math.ceil(count / 7)
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
  // Moves on each minute, so a dashboard left open past midnight shows the
  // new day.
  const now = new Date(useNow(60_000))
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
  const [live, setLive] = useState(liveChosen)
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
  // How far the office's clock is ahead of UTC, for the busy-hours chart.
  const tz = -now.getTimezoneOffset()

  // Everything on this page comes in this one answer.
  const stats = useApi<Stats>(`/stats?start=${since}&days=${span}&size=${size}&tz=${tz}`, {
    every: live ? LIVE_EVERY : undefined,
  })
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
  // Wait for the numbers of the period now chosen, not the one before.
  const ready = Boolean(stats.data && stats.fresh && !finding)

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
  // A newer entry came in since (Live, or a refresh): "All time" now reaches
  // on to its day, so it shows up. Any answer knows the newest entry.
  const newest = answer?.last ? startOfDay(new Date(answer.last)) : 0
  if (days === ALL && whole && newest > whole.last) {
    setWhole({ ...whole, last: newest })
  }

  // What is drawn: this period's numbers when they are here, otherwise the
  // last period's, dimmed, so nothing jumps while the new ones load.
  const view: OverviewProps | null =
    ready && stats.data
      ? {
          stats: stats.data,
          start,
          end,
          size,
          steps,
          onStep: setStep,
          allTime: days === ALL,
          endsToday: end >= startOfDay(now),
          length: custom ? span : days,
          period,
          during,
        }
      : null
  const [held, setHeld] = useState<OverviewProps | null>(null)
  if (
    view &&
    (held === null ||
      held.stats !== view.stats ||
      held.start !== view.start ||
      held.end !== view.end ||
      held.size !== view.size)
  ) {
    setHeld(view)
  }
  const shown = view ?? held

  // A message when Live brings in new entries for the period on screen.
  const counted = useRef<{ key: string; entries: number } | null>(null)
  const entriesNow =
    ready && stats.data ? stats.data.columns.reduce((n, column) => n + columnTotal(column), 0) : -1
  useEffect(() => {
    if (entriesNow < 0) return
    const key = `${since}|${span}|${size}`
    const before = counted.current
    if (before && before.key === key && entriesNow > before.entries) {
      const more = entriesNow - before.entries
      toast(
        `${more.toLocaleString('en-IN')} new ${more === 1 ? 'entry' : 'entries'} just came in`,
        'info',
      )
    }
    counted.current = { key, entries: entriesNow }
  }, [entriesNow, since, span, size])

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

  function toggleLive() {
    const next = !live
    setLive(next)
    try {
      localStorage.setItem(LIVE_KEY, next ? 'on' : 'off')
    } catch {
      // Remembered for this visit only.
    }
    if (next) stats.reload()
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
        {stats.error && !shown ? (
          <p className="problem">{stats.error}</p>
        ) : !shown ? (
          <PageSkeleton tiles={4} />
        ) : (
          <>
            <div className="filters-row">
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

              <div className="live-controls">
                <button
                  type="button"
                  className={`live-toggle${live ? ' on' : ''}`}
                  aria-pressed={live}
                  title={
                    live
                      ? 'New entries appear by themselves. Press to pause.'
                      : 'Press to show new entries as they come in'
                  }
                  onClick={toggleLive}
                >
                  <span className="live-dot" aria-hidden="true" />
                  {live ? 'Live' : 'Paused'}
                </button>
                <Updated at={stats.updatedAt} loading={stats.loading} />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Check for new entries now"
                  title="Check now"
                  onClick={stats.reload}
                >
                  <span className={stats.loading ? 'spin' : 'still'}>
                    <RefreshIcon />
                  </span>
                </button>
              </div>
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

            {stats.error && <p className="problem">{stats.error}</p>}

            <Overview {...shown} stale={!view} />
          </>
        )}
      </div>
    </>
  )
}

type OverviewProps = {
  stats: Stats
  // Midnight on the first and the last day of the period, and how many
  // days a column covers.
  start: number
  end: number
  size: number
  // The column sizes that can be picked, and what to do when one is.
  steps: { size: number; label: string; fits: boolean }[]
  onStep: (size: number) => void
  allTime: boolean
  // True when the period runs up to today.
  endsToday: boolean
  // How many days the period has, for comparing with the days before it.
  length: number
  // The period's name ("last 30 days"), and the words for "in it".
  period: string
  during: string
  // Numbers of an earlier period, shown dimmed while the new ones load.
  stale?: boolean
}

function Overview({
  stats,
  start,
  end,
  size,
  steps,
  onStep,
  allTime,
  endsToday,
  length,
  period,
  during,
  stale = false,
}: OverviewProps) {
  const crops = cropSeries(stats.series)
  const cropParts = crops.split(sum(stats.columns))
  const current = total(cropParts)
  const kpis = stats.kpis
  const lots = stats.lots
  const first = stats.first ? dayMonthYear(new Date(stats.first).getTime()) : ''
  const last = stats.last ? dayMonthYear(new Date(stats.last).getTime()) : ''
  const channelRows: BarRow[] = stats.channels.map((channel) => ({
    name: channel.name,
    parts: crops.split(channel.counts),
  }))
  const columns = buildColumns(stats.columns, start, end, size, crops.split)
  const found = insights({
    stats,
    parts: cropParts,
    current,
    allTime,
    days: Math.max(1, Math.round((end - start) / DAY) + 1),
    columnName: columnName(size),
    columnNames: columns.map((column) => column.name),
    endsToday,
    period,
  })

  return (
    <div className={`overview${stale ? ' stale' : ''}`} aria-busy={stale}>
      <div className="stats">
        {/* Each tile opens where its number comes from. */}
        <Link className="card stat solid blue" to="/users" title="See the farmer entries">
          <span className="stat-icon" aria-hidden="true">
            <InboxIcon />
          </span>
          <p className="stat-label">Farmer entries</p>
          <p className="stat-value">
            <CountUp value={current} />
          </p>
          {allTime ? (
            // Nothing came before all time, so there is nothing to compare.
            <p className="stat-note">
              {first ? (first === last ? `on ${first}` : `${first} to ${last}`) : 'none yet'}
            </p>
          ) : (
            <Change now={current} before={stats.previous} days={length} />
          )}
          <Sparkline values={stats.columns.map(columnTotal)} />
        </Link>

        <Link className="card stat solid plum" to="/users" title="See the farmer entries">
          <span className="stat-icon" aria-hidden="true">
            <UsersIcon />
          </span>
          <p className="stat-label">Farmers reached</p>
          <p className="stat-value">
            <CountUp value={kpis.farmers} />
          </p>
          <p className="stat-note">
            {kpis.farmers === 0
              ? 'counted by mobile number'
              : kpis.repeatFarmers > 0
                ? `${kpis.repeatFarmers.toLocaleString('en-IN')} numbers on more than one entry`
                : 'every mobile number different'}
          </p>
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
            <CountUp value={allTime ? lots.total : stats.lotCount} />
          </p>
          <p className="stat-note">
            {allTime
              ? lots.total === 0
                ? 'none yet'
                : lots.unused === 0
                  ? 'every lot has farmer entries'
                  : `${lots.unused.toLocaleString('en-IN')} with no entries yet`
              : stats.lotCount === 0
                ? 'none in this period'
                : `of ${lots.total.toLocaleString('en-IN')} in all`}
          </p>
        </Link>

        {/* The channels are listed further down this page. */}
        <a className="card stat solid amber" href="#channels" title="See the busiest channels">
          <span className="stat-icon" aria-hidden="true">
            <PhoneIcon />
          </span>
          <p className="stat-label">Distribution channels</p>
          <p className="stat-value">
            <CountUp value={stats.channelCount} />
          </p>
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
        <Insights items={found} />
        <Quality kpis={kpis} current={current} />
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
              <div className="range small" role="group" aria-label="One column for each">
                {steps.map((choice) => (
                  <button
                    key={choice.size}
                    type="button"
                    className={choice.size === size ? 'on' : ''}
                    aria-pressed={choice.size === size}
                    disabled={!choice.fits}
                    onClick={() => onStep(choice.size)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="card-body">
            <ColumnChart columns={columns} unit={['entry', 'entries']} />
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

      {stats.heatmap.length === 7 && (
        <section className="card">
          <div className="card-head">
            <h2>When farmers fill in the form</h2>
            <p>By day of the week and hour, {period}</p>
          </div>
          <div className="card-body">
            <Heatmap counts={stats.heatmap} />
          </div>
        </section>
      )}

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

        <Latest
          entries={stats.latest}
          empty={allTime ? 'Nothing has come in yet' : `Nothing came in ${during}`}
          noLots={lots.total === 0}
        />
      </div>

      {lots.unused > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>New lots nobody has scanned yet</h2>
            <p>{lots.unused.toLocaleString('en-IN')} waiting</p>
          </div>
          <ul className="rows">
            {lots.waiting.map((lot) => (
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
    </div>
  )
}

const INSIGHT_ICONS = {
  up: TrendUpIcon,
  down: TrendDownIcon,
  warn: AlertIcon,
  info: SparkIcon,
}

const FIRST_INSIGHTS = 5

// What the numbers say, written out: things to check and changes first.
function Insights({ items }: { items: Insight[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, FIRST_INSIGHTS)
  return (
    <section className="card insights">
      <div className="card-head">
        <h2 className="with-icon">
          <SparkIcon /> Insights
        </h2>
        <p>Worked out from the numbers on this page</p>
      </div>
      <ul className="insight-list">
        {shown.map((item, index) => {
          const Icon = INSIGHT_ICONS[item.tone]
          return (
            <li
              key={item.key}
              className={`insight ${item.tone}`}
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <span className="insight-icon" aria-hidden="true">
                <Icon />
              </span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.text}</p>
              </div>
            </li>
          )
        })}
      </ul>
      {items.length > FIRST_INSIGHTS && (
        <div className="card-foot">
          <button type="button" className="link-button" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show ${items.length - FIRST_INSIGHTS} more`}
          </button>
        </div>
      )}
    </section>
  )
}

// How complete the entries are: the details the office relies on later.
function Quality({ kpis, current }: { kpis: Stats['kpis']; current: number }) {
  const rows = [
    { label: 'Mobile number given', value: kpis.withContact },
    { label: 'ID number given', value: kpis.withId },
    { label: 'Filled in by a field officer', value: kpis.byOfficer },
  ]
  return (
    <section className="card">
      <div className="card-head">
        <h2>What the entries contain</h2>
        <p>Share of entries in the period</p>
      </div>
      <div className="card-body meters">
        {rows.map((row) => {
          const share = current > 0 ? Math.round((row.value / current) * 100) : 0
          return (
            <div key={row.label} className="meter">
              <div className="meter-label">
                <span>{row.label}</span>
                <strong>{share}%</strong>
              </div>
              <span
                className="meter-track"
                role="meter"
                aria-label={row.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={share}
              >
                <span style={{ width: `${share}%` }} />
              </span>
              <span className="meter-note">
                {row.value.toLocaleString('en-IN')} of {current.toLocaleString('en-IN')}
              </span>
            </div>
          )
        })}
        <p className="meter-foot">
          <PhoneIcon />
          {kpis.devices === 0
            ? 'No phones recorded yet.'
            : `${kpis.devices.toLocaleString('en-IN')} different ${kpis.devices === 1 ? 'phone' : 'phones'} sent these entries.`}
        </p>
      </div>
    </section>
  )
}

// The newest entries of the period. Rows that arrived since the last look
// light up for a moment.
function Latest({
  entries,
  empty,
  noLots,
}: {
  entries: Stats['latest']
  empty: string
  noLots: boolean
}) {
  // Rows that were not in the list last time, when the list moved on by a
  // few rather than being replaced (another period was picked).
  const ids = entries.map((entry) => entry.id).join('\n')
  const [last, setLast] = useState({ ids, fresh: new Set<string>() })
  if (last.ids !== ids) {
    const before = new Set(last.ids.split('\n'))
    const kept = entries.filter((entry) => before.has(entry.id)).length
    setLast({
      ids,
      fresh: new Set(kept > 0 ? entries.filter((e) => !before.has(e.id)).map((e) => e.id) : []),
    })
  }
  const clock = useNow(15_000)

  return (
    <section className="card">
      <div className="card-head">
        <h2>Latest farmer entries</h2>
        {entries.length > 0 && <Link to="/users">See all</Link>}
      </div>
      {entries.length === 0 ? (
        <p className="empty">
          <strong>{empty}</strong>
          {noLots
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
              {entries.map((e) => {
                const received = new Date(e.receivedAt).getTime()
                return (
                  <tr key={e.id} className={last.fresh.has(e.id) ? 'fresh' : ''}>
                    <td className="strong">{e.farmerName}</td>
                    <td>{e.crop}</td>
                    <td>{e.quantity}</td>
                    <td title={formatDateTime(e.receivedAt)}>
                      {clock - received < DAY ? ago(received, clock) : formatDateTime(e.receivedAt)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// "Updated 20 seconds ago", with its own clock so only it redraws as time passes.
function Updated({ at, loading }: { at?: number; loading: boolean }) {
  const clock = useNow()
  return <span className="muted updated">{loading ? 'Updating…' : `Updated ${ago(at, clock)}`}</span>
}

// How this period compares with the one just before it.
function Change({ now, before, days }: { now: number; before: number; days: number }) {
  const difference = now - before
  if (difference === 0) {
    return <p className="stat-note">same as the {days} days before</p>
  }
  const share = before > 0 ? ` (${Math.round((Math.abs(difference) / before) * 100)}%)` : ''
  return (
    <p className="stat-note">
      <span className={difference > 0 ? 'up' : 'down'} aria-hidden="true">
        {difference > 0 ? '▲' : '▼'}
      </span>{' '}
      {Math.abs(difference).toLocaleString('en-IN')}
      {share} {difference > 0 ? 'more' : 'fewer'} than the {days} days before
    </p>
  )
}

export default Dashboard
