import type { ReceivedEntry } from './types'

// One coloured thing in a chart. Here a series is always a crop.
export type Series = { name: string; color: string }
export type Part = Series & { value: number }

// A fixed order chosen so neighbouring colours stay distinguishable for
// colour-blind readers. Do not reorder or add to it; extra crops fold
// into "Other".
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7']
const OTHER: Series = { name: 'Other', color: '#9aa3b2' }

function cropKey(entry: ReceivedEntry): string {
  return (entry.lot?.crop ?? '').trim().toLowerCase()
}

// Gives every crop its own colour. Colours are handed out in the order the
// crops first appeared, using all entries, so a crop keeps its colour when
// the time period changes.
export function cropSeries(allEntries: ReceivedEntry[]) {
  const byKey = new Map<string, Series>()
  const oldestFirst = [...allEntries].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  for (const entry of oldestFirst) {
    const key = cropKey(entry)
    if (byKey.has(key)) continue
    const color = COLORS[byKey.size]
    byKey.set(key, color ? { name: entry.lot?.crop.trim() || 'Not given', color } : OTHER)
  }
  const list = [...new Set(byKey.values())]

  // Splits a group of entries into one part per crop, in the fixed order.
  function split(entries: ReceivedEntry[]): Part[] {
    const counts = new Map<Series, number>()
    for (const entry of entries) {
      const series = byKey.get(cropKey(entry)) ?? OTHER
      counts.set(series, (counts.get(series) ?? 0) + 1)
    }
    return list
      .filter((series) => counts.has(series))
      .map((series) => ({ ...series, value: counts.get(series)! }))
  }

  return { list, split }
}

export function total(parts: Part[]): number {
  return parts.reduce((sum, part) => sum + part.value, 0)
}
