import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { PageSkeleton } from '../components/Skeleton'
import { useApi } from '../data/api'
import { cropSeries, total } from '../data/series'
import { titleCase } from '../data/text'
import type { ChannelList } from '../data/types'

// Channels drawn at first, and added each time "Show more" is pressed.
const STEP = 100
const DAY = 86_400_000

// "2026-07-01", as the dashboard's link gives it, as midnight on that day.
function dayOf(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

function longDate(time: number): string {
  return new Date(time).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// Every distribution channel farmers named, busiest first: the whole list
// behind the dashboard's top five. The dashboard's "See all" passes its
// period as ?from=…&to=… (both days included).
function Channels() {
  const [params] = useSearchParams()
  const from = dayOf(params.get('from'))
  const to = dayOf(params.get('to'))
  // A season ("Kharif") counts its days in every year.
  const season = params.get('season')?.trim() || null
  const limited = from !== null && to !== null && from <= to
  // How far the office's clock is ahead of UTC, read once.
  const [tz] = useState(() => -new Date().getTimezoneOffset())
  const path = season
    ? `/channels?season=${encodeURIComponent(season)}&tz=${tz}`
    : limited
      ? `/channels?from=${encodeURIComponent(new Date(from).toISOString())}` +
        `&to=${encodeURIComponent(new Date(to + DAY).toISOString())}`
      : '/channels'
  const { data, error } = useApi<ChannelList>(path)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(STEP)

  const subtitle = season
    ? `Entries in ${season}, every year together, busiest channel first.`
    : limited
      ? `Entries from ${longDate(from)} to ${longDate(to)}, busiest channel first.`
      : 'Every channel farmers named, busiest first, over all time.'

  return (
    <>
      <PageHeader title="Distribution channels" subtitle={subtitle}>
        {(limited || season) && (
          <Link className="button secondary" to="/channels">
            Show all time
          </Link>
        )}
      </PageHeader>

      <div className="page">
        {error ? (
          <p className="problem">{error}</p>
        ) : !data ? (
          <PageSkeleton />
        ) : (
          <ChannelTable data={data} query={query} onQuery={setQuery} limit={limit} onMore={() => setLimit(limit + STEP)} />
        )}
      </div>
    </>
  )
}

type ChannelTableProps = {
  data: ChannelList
  query: string
  onQuery: (query: string) => void
  // How many rows to draw.
  limit: number
  onMore: () => void
}

function ChannelTable({ data, query, onQuery, limit, onMore }: ChannelTableProps) {
  const crops = cropSeries(data.series)
  // Ranked over all channels, so a search keeps each one's place.
  const ranked = data.channels.map((channel, index) => {
    const parts = crops.split(channel.counts)
    return { ...channel, rank: index + 1, parts, sum: total(parts) }
  })
  const needle = query.trim().toLowerCase()
  const found = needle ? ranked.filter((row) => row.name.toLowerCase().includes(needle)) : ranked
  const rows = found.slice(0, limit)
  // Bars are drawn against the busiest channel of all.
  const most = Math.max(1, ranked[0]?.sum ?? 0)
  // Every crop that appears in the list, for the colour key.
  const used = crops.split(Object.assign({}, ...data.channels.map((channel) => channel.counts)))

  return (
    <section className="card">
      <div className="card-head filters">
        <input
          className="search"
          type="search"
          aria-label="Search channels"
          placeholder="Search channels"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        <div className="filter-count">
          <p>
            {needle
              ? `${found.length.toLocaleString('en-IN')} of ${ranked.length.toLocaleString('en-IN')} channels`
              : `${ranked.length.toLocaleString('en-IN')} channels · ${data.total.toLocaleString('en-IN')} entries`}
          </p>
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="empty">
          <strong>No channels yet</strong>
          They appear here when farmers' entries name where the seed came from.
        </p>
      ) : found.length === 0 ? (
        <p className="empty">
          <strong>No channels match</strong>
          Try a shorter search.
        </p>
      ) : (
        <>
          {used.length > 1 && (
            <ul className="legend channel-legend">
              {used.map((crop) => (
                <li key={crop.name}>
                  <i style={{ background: crop.color }} />
                  <span>{crop.name}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="table-wrap">
            <table className="channel-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Channel and its crops</th>
                  <th className="num">Entries</th>
                  <th className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const share = data.total ? (row.sum / data.total) * 100 : 0
                  return (
                    <tr key={row.name}>
                      <td className="num">
                        <span className="bar-rank">{row.rank}</span>
                      </td>
                      <td className="channel-cell">
                        {/* A long name is cut after two lines; its title has the rest. */}
                        {row.name === 'Not given' ? (
                          <span className="channel-name muted">Not given</span>
                        ) : (
                          // Opens the Farmers page searching for this channel.
                          <Link
                            className="channel-name"
                            to={`/users?q=${encodeURIComponent(row.name)}`}
                            title={`${row.name}\nSee this channel's farmer entries`}
                          >
                            {/* Capital first letters, however it was typed. The
                                search above and the Farmers link use the name
                                as stored. */}
                            {titleCase(row.name)}
                          </Link>
                        )}
                        <span className="bar-track">
                          <span style={{ width: `${(row.sum / most) * 100}%` }}>
                            {row.parts.map((part) => (
                              <span
                                key={part.name}
                                title={`${part.name}: ${part.value.toLocaleString('en-IN')}`}
                                style={{ flexGrow: part.value, background: part.color }}
                              />
                            ))}
                          </span>
                        </span>
                      </td>
                      <td className="num strong">{row.sum.toLocaleString('en-IN')}</td>
                      <td className="num muted">
                        {share > 0 && share < 1 ? 'under 1%' : `${Math.round(share)}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {found.length > rows.length && (
            <div className="card-foot">
              <button type="button" className="secondary compact" onClick={onMore}>
                Show {Math.min(STEP, found.length - rows.length)} more
              </button>
              <span className="muted">
                Showing {rows.length.toLocaleString('en-IN')} of{' '}
                {found.length.toLocaleString('en-IN')}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default Channels
