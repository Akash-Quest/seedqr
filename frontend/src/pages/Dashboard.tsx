import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { Link } from 'react-router-dom'
import BarList from '../components/BarList'
import type { BarRow } from '../components/BarList'
import ColumnChart from '../components/ColumnChart'
import type { Column } from '../components/ColumnChart'
import CountUp from '../components/CountUp'
import Donut from '../components/Donut'
import {
  ChevronRightIcon,
  InboxIcon,
  PhoneIcon,
  PlusIcon,
  QrIcon,
  MapIcon,
  RefreshIcon,
} from '../components/Icons'
import PageHeader from '../components/PageHeader'
import { PageSkeleton } from '../components/Skeleton'
import Sparkline from '../components/Sparkline'
import VarietyTip from '../components/VarietyTip'
import { canEdit, useApi } from '../data/api'
import { ago, useNow } from '../data/motion'
import { tidyQuantity, titleCase } from '../data/text'
import { cropSeries, sum, total } from '../data/series'
import type { Part, Series } from '../data/series'
import { toast } from '../data/toast'
import { formatDateTime, usableDay } from '../data/types'
import type { CropCounts, Season, Stats } from '../data/types'

// Stand for "All time" and "Custom" where the others give a number of days.
// "All time" is everything since the first entry; a season is one run of
// Rabi, Kharif or Garma; "Custom" is from one picked day to another.
const ALL = 0
const CUSTOM = -1
const SEASON = -2

// The seasons' buttons. Their dates are set on the server
// (backend/app/seasons.py); the names must match the ones there.
const SEASON_ORDER = ['Rabi', 'Kharif', 'Garma']

const DAY = 86_400_000

// The map of channels: its code and its outline of Bihar are fetched only
// when it is opened (or about to be).
const ChannelMap = lazy(() => import('../components/ChannelMap'))
const warmMap = () => void import('../components/ChannelMap')
// How many days one chart column may cover: a week at least. "All time"
// takes the smallest that keeps the chart to about a month's worth of
// columns.
const COLUMN_DAYS = [7, 30, 90, 365]
const MOST_COLUMNS = 31
// The column sizes that can be picked over the chart.
const STEPS = [
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

// Only the years of one run of a season: "2025–26", or "2026".
function yearsOf(run: Season): string {
  return run.label.replace(`${run.season} `, '')
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

function Legend({
  series,
  varieties = {},
}: {
  series: Series[]
  // Each crop's varieties, listed when its name is pointed at.
  varieties?: Record<string, Record<string, number>>
}) {
  return (
    <ul className="legend below">
      {series.map((item) => (
        <li
          key={item.name}
          className={varieties[item.name] ? 'has-tip' : undefined}
          tabIndex={varieties[item.name] ? 0 : undefined}
        >
          <i style={{ background: item.color }} />
          <span>{item.name}</span>
          <VarietyTip varieties={varieties[item.name]} />
        </li>
      ))}
    </ul>
  )
}

// What the map asks for: every channel's entries in the period on screen,
// asked the same way as the Channels page.
function channelsPath(view: OverviewProps): string {
  if (view.season) {
    return `/channels?season=${encodeURIComponent(view.season)}&tz=${-new Date().getTimezoneOffset()}`
  }
  if (view.allTime) return '/channels'
  return (
    `/channels?from=${encodeURIComponent(new Date(view.start).toISOString())}` +
    `&to=${encodeURIComponent(new Date(view.end + DAY).toISOString())}`
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
  const [mapOpen, setMapOpen] = useState(false)
  const draftReady = usableDay(draftFrom) && usableDay(draftTo) && draftFrom <= draftTo
  const draftChanged = draftFrom !== from || draftTo !== to
  // The season chosen, by name ("Rabi"), and which year of it: the first
  // day of that run ("2025-10-15"), its days then in `from` and `to`. No
  // year means every year at once: the chart runs over all time, and only
  // that season's entries are counted.
  const [season, setSeason] = useState<string | null>(null)
  const [seasonYear, setSeasonYear] = useState<string | null>(null)
  const custom = days === CUSTOM
  const oneYear = days === SEASON && seasonYear !== null
  // Picked days, or one year's season: kept to exactly those days.
  const ranged = custom || oneYear
  // All time, or a season over all time.
  const everything = days === ALL || (days === SEASON && seasonYear === null)
  // Both days are there and in the right order.
  const picked = from !== '' && to !== '' && from <= to
  // "All time" is chosen, but what it covers is still being asked. Any
  // answer says when the first and latest entries came in, so a week is
  // asked for.
  const finding = everything && whole === null

  // The last day shown: today, the last day picked, or for "All time" the
  // day of the latest entry, so the chart does not trail off into months
  // with nothing in them.
  const end = ranged
    ? picked
      ? dayOf(to)
      : startOfDay(now)
    : everything && whole
      ? whole.last
      : startOfDay(now)
  // How many days to show: the number chosen, every day picked, or for
  // "All time" every day from the first entry to the latest.
  const wanted = ranged
    ? picked
      ? Math.round((dayOf(to) - dayOf(from)) / DAY) + 1
      : 7
    : !everything
      ? days
      : whole === null
        ? 7
        : Math.round((whole.last - whole.first) / DAY) + 1
  const fitting =
    everything || ranged
      ? (COLUMN_DAYS.find((length) => wanted / length <= MOST_COLUMNS) ?? 365)
      : 7
  // A size fits when a column is no longer than the period (a week always
  // fits: it is the smallest), and there are not too many columns to draw.
  const fits = (length: number) =>
    length <= Math.max(wanted, 7) && Math.ceil(wanted / length) <= MOST_DRAWN
  const steps = STEPS.map((choice) => ({ ...choice, fits: fits(choice.size) }))
  // A picked size that no longer fits the period gives way to the fitting one.
  const size = step !== null && fits(step) ? step : fitting
  // Drawn in whole columns, so the 90 day view covers 91 days. Picked days
  // are kept exactly: the last column is cut short instead.
  const span = ranged ? wanted : Math.ceil(wanted / size) * size
  const start = end - (span - 1) * DAY
  const since = encodeURIComponent(new Date(start).toISOString())
  // How far the office's clock is ahead of UTC, for the busy-hours chart.
  const tz = -now.getTimezoneOffset()

  // Only this season's entries, in every year, when "All years" is chosen.
  const seasonShown = days === SEASON && season && seasonYear === null ? season : null
  const only = seasonShown ? `&season=${encodeURIComponent(seasonShown)}` : ''

  // Everything on this page comes in this one answer.
  const stats = useApi<Stats>(
    `/stats?start=${since}&days=${span}&size=${size}&tz=${tz}${only}`,
    { every: live ? LIVE_EVERY : undefined },
  )
  // Every year of every season up to today, newest first, for the menus.
  const seasons = useApi<Season[]>(`/seasons?tz=${tz}`)
  const runs = (seasons.data ?? []).filter((one) => one.season === season)
  // The year of the season on screen, if one is chosen.
  const run = oneYear ? runs.find((one) => one.start === seasonYear) : undefined

  // How the period is named on the page.
  const period = run
    ? run.label
    : seasonShown
      ? `${seasonShown}, all years`
      : ranged
        ? `${dayMonthYear(start)} to ${dayMonthYear(end)}`
        : days === ALL
          ? 'all time'
          : `last ${days} days`
  const during = run
    ? `in ${run.label}`
    : seasonShown
    ? `in ${seasonShown}`
    : ranged
      ? `from ${period}`
      : days === ALL
        ? 'in all'
        : `during the ${period}`

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
  if (everything && whole && newest > whole.last) {
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
          season: seasonShown,
          length: ranged ? span : days,
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
      held.size !== view.size ||
      held.season !== view.season)
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
    const key = `${since}|${span}|${size}|${only}`
    const before = counted.current
    if (before && before.key === key && entriesNow > before.entries) {
      const more = entriesNow - before.entries
      toast(
        `${more.toLocaleString('en-IN')} new ${more === 1 ? 'entry' : 'entries'} just came in`,
        'info',
      )
    }
    counted.current = { key, entries: entriesNow }
  }, [entriesNow, since, span, size, only])

  function choose(next: number) {
    // Looked up afresh each time, in case entries were imported since.
    if (next === ALL || next === SEASON) setWhole(null)
    // "Custom" starts on what is showing now, ready to be narrowed down.
    if (next === CUSTOM) {
      setFrom(dateValue(start))
      setTo(dateValue(end))
      setDraftFrom(dateValue(start))
      setDraftTo(dateValue(end))
    }
    setDays(next)
  }

  // One year of a season: its days, cut at today while it is running. One
  // that has not begun yet shows all its days, empty.
  function showYear(one: Season) {
    const today = startOfDay(now)
    const last = dayOf(one.end)
    setSeason(one.season)
    setSeasonYear(one.start)
    setFrom(one.start)
    setTo(dateValue(dayOf(one.start) > today ? last : Math.min(last, today)))
    setDays(SEASON)
  }

  // A season in every year at once.
  function showAllYears(name: string) {
    setSeason(name)
    setSeasonYear(null)
    choose(SEASON)
  }

  // The season whose years are listed under its button, and where that
  // button starts, from the left of the row.
  const [menu, setMenu] = useState<{ name: string; left: number } | null>(null)
  const menuBox = useRef<HTMLDivElement>(null)

  // A click anywhere else, or Escape, closes the list.
  useEffect(() => {
    if (!menu) return
    function onDown(event: PointerEvent) {
      const target = event.target as Element
      if (menuBox.current?.contains(target) || target.closest('.season-button')) return
      setMenu(null)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // A season's button shows its latest year that had entries (or every year,
  // when none had) and lists its years under it. Pressed again, it opens or
  // closes the list.
  function chooseSeason(name: string, button: HTMLButtonElement) {
    const row = button.closest('.period-controls')
    const left = row ? button.getBoundingClientRect().left - row.getBoundingClientRect().left : 0
    if (days === SEASON && season === name) {
      setMenu(menu?.name === name ? null : { name, left })
      return
    }
    const latest = (seasons.data ?? []).find((one) => one.season === name && one.entries > 0)
    if (latest) showYear(latest)
    else showAllYears(name)
    setMenu({ name, left })
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
            Add a seed variety
          </Link>
        )}
      </PageHeader>

      <div className="page">
        {stats.error && !shown ? (
          <p className="problem">{stats.error}</p>
        ) : !shown ? (
          <PageSkeleton tiles={3} />
        ) : (
          <>
            <div className="filters-row">
              <div className="period-controls">
                <div className="range" role="group" aria-label="Time period">
                  <button
                    type="button"
                    className={days === ALL ? 'on' : ''}
                    aria-pressed={days === ALL}
                    onClick={() => choose(ALL)}
                  >
                    All time
                  </button>
                  {/* Each season, with its years in a list under it. The
                      dates are set on the server. */}
                  {SEASON_ORDER.map((name) => {
                    const on = days === SEASON && season === name
                    return (
                      <button
                        key={name}
                        type="button"
                        className={on ? 'on season-button' : 'season-button'}
                        aria-pressed={on}
                        aria-haspopup="menu"
                        aria-expanded={menu?.name === name}
                        onClick={(event) => chooseSeason(name, event.currentTarget)}
                      >
                        {name}
                        {on && (
                          <span className="season-year">
                            {run ? yearsOf(run) : 'All years'}
                          </span>
                        )}
                        <span className="season-caret" aria-hidden="true">
                          <ChevronRightIcon />
                        </span>
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    className={custom ? 'on' : ''}
                    aria-pressed={custom}
                    onClick={() => choose(CUSTOM)}
                  >
                    Custom
                  </button>
                </div>

                {/* The season's years, opened under its button: every year
                    together first, then each year. Outside the row of
                    buttons, which cuts off whatever reaches past it. */}
                {menu && (
                  <div
                    ref={menuBox}
                    className="season-menu"
                    role="menu"
                    aria-label={`${menu.name} seasons`}
                    style={{ left: menu.left }}
                  >
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={season === menu.name && seasonShown !== null}
                      className={season === menu.name && seasonShown !== null ? 'on' : ''}
                      onClick={() => {
                        showAllYears(menu.name)
                        setMenu(null)
                      }}
                    >
                      <span>All years</span>
                      <small>
                        {(seasons.data ?? [])
                          .filter((one) => one.season === menu.name)
                          .reduce((n, one) => n + one.entries, 0)
                          .toLocaleString('en-IN')}{' '}
                        entries
                      </small>
                    </button>
                    {(seasons.data ?? [])
                      .filter((one) => one.season === menu.name)
                      .map((one) => {
                        const current = run?.start === one.start
                        return (
                          <button
                            key={one.start}
                            type="button"
                            role="menuitemradio"
                            aria-checked={current}
                            className={current ? 'on' : ''}
                            onClick={() => {
                              showYear(one)
                              setMenu(null)
                            }}
                          >
                            <span>{yearsOf(one)}</span>
                            <small>
                              {one.entries.toLocaleString('en-IN')}{' '}
                              {one.entries === 1 ? 'entry' : 'entries'}
                            </small>
                          </button>
                        )
                      })}
                  </div>
                )}
              </div>

              <div className="live-controls">
                <button
                  type="button"
                  className="map-button"
                  onPointerEnter={warmMap}
                  onFocus={warmMap}
                  onClick={() => setMapOpen(true)}
                >
                  <MapIcon />
                  Map view
                </button>
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

            <Overview {...shown} stale={!view} onMap={() => setMapOpen(true)} />

            {mapOpen && (
              <Suspense fallback={null}>
                <ChannelMap
                  path={channelsPath(shown)}
                  period={shown.period}
                  onClose={() => setMapOpen(false)}
                />
              </Suspense>
            )}
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
  // The season shown, in every year, or null.
  season: string | null
  // How many days the period has, for comparing with the days before it.
  length: number
  // The period's name ("last 30 days"), and the words for "in it".
  period: string
  during: string
  // Numbers of an earlier period, shown dimmed while the new ones load.
  stale?: boolean
  // Opens the map of channels for the same period.
  onMap?: () => void
}

function Overview({
  stats,
  start,
  end,
  size,
  steps,
  onStep,
  allTime,
  season,
  length,
  period,
  during,
  stale = false,
  onMap,
}: OverviewProps) {
  const crops = cropSeries(stats.series)
  const cropParts = crops.split(sum(stats.columns))
  const current = total(cropParts)
  const lots = stats.lots
  const channelRows: BarRow[] = stats.channels.map((channel) => ({
    // Capital first letters, like the latest entries beside them.
    name: channel.name === 'Not given' ? channel.name : titleCase(channel.name),
    parts: crops.split(channel.counts),
  }))
  const columns = buildColumns(stats.columns, start, end, size, crops.split)

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
          {/* Nothing came before all time, so there is nothing to compare;
              a season over every year has no "days before" either. */}
          {!allTime && !season && (
            <Change now={current} before={stats.previous} days={length} />
          )}
          <Sparkline values={stats.columns.map(columnTotal)} />
        </Link>

        <Link className="card stat solid green" to="/barcode" title="See the seed lots">
          <span className="stat-icon" aria-hidden="true">
            <QrIcon />
          </span>
          {/* For a period: the lots farmers' entries were for in it. Not the
              lots made in it: an import makes its lots on the day of the
              import, long after the entries in it came in. */}
          <p className="stat-label">{allTime ? 'Seed Varieties' : 'Seed Varieties with entries'}</p>
          <p className="stat-value">
            <CountUp value={allTime ? lots.total : stats.lotCount} />
          </p>
          <p className="stat-note">
            {allTime
              ? lots.total === 0
                ? 'none yet'
                : lots.unused === 0
                  ? 'Every variety has farmer entries'
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
              ? `Busiest one has ${total(channelRows[0].parts).toLocaleString('en-IN')} entries`
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
            <Legend series={cropParts} varieties={stats.varieties} />
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
                varieties={stats.varieties}
              />
            </div>
          )}
        </section>
      </div>

      <div className="split even">
        <section className="card" id="channels">
          <div className="card-head">
            <h2>Busiest distribution channels</h2>
            {onMap && (
              <button
                type="button"
                className="link-button map-link"
                onPointerEnter={warmMap}
                onClick={onMap}
              >
                <MapIcon /> Map
              </button>
            )}
            {/* Every channel of the same period, on a page of its own. */}
            <Link
              to={
                season
                  ? `/channels?season=${encodeURIComponent(season)}`
                  : allTime
                    ? '/channels'
                    : `/channels?from=${dateValue(start)}&to=${dateValue(end)}`
              }
            >
              See all
            </Link>
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
            ? 'Add a seed variety and print its QR code to get started.'
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
                    {/* Written the same way however they were typed:
                        "Hari Narayan Singh", "Moong", "2 kg". */}
                    <td className="strong">{titleCase(e.farmerName)}</td>
                    <td>{titleCase(e.crop)}</td>
                    <td>{tidyQuantity(e.quantity)}</td>
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
