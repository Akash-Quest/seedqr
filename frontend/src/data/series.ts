import type { CropCounts } from './types'

// One coloured thing in a chart. Here a series is always a crop.
export type Series = { name: string; color: string }
export type Part = Series & { value: number }

// A fixed order chosen so neighbouring colours stay distinguishable for
// colour-blind readers. Do not reorder or add to it; extra crops fold
// into "Other".
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7']
const OTHER: Series = { name: 'Other', color: '#9aa3b2' }

// Gives every crop its own colour. The server lists the crops in the order
// they first appeared, over all entries, so a crop keeps its colour when the
// time period changes.
export function cropSeries(crops: string[]) {
  const byName = new Map<string, Series>()
  crops.forEach((name, index) => {
    const color = COLORS[index]
    byName.set(name, color ? { name, color } : OTHER)
  })
  const list = [...new Set([...byName.values(), OTHER])]

  // Turns counts by crop into one part per crop, in the fixed order.
  function split(counts: CropCounts): Part[] {
    const totals = new Map<Series, number>()
    for (const [name, value] of Object.entries(counts)) {
      const series = byName.get(name) ?? OTHER
      totals.set(series, (totals.get(series) ?? 0) + value)
    }
    return list
      .filter((series) => totals.has(series))
      .map((series) => ({ ...series, value: totals.get(series)! }))
  }

  return { split }
}

// Adds up counts by crop, for example every column of a chart.
export function sum(all: CropCounts[]): CropCounts {
  const out: CropCounts = {}
  for (const counts of all) {
    for (const [name, value] of Object.entries(counts)) out[name] = (out[name] ?? 0) + value
  }
  return out
}

export function total(parts: Part[]): number {
  return parts.reduce((sum, part) => sum + part.value, 0)
}
