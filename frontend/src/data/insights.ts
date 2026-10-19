import type { Part } from './series'
import type { Stats } from './types'

// Things the numbers say, written out so nobody has to work them out from
// the charts. Each is worded for the period shown, and only appears when
// it is true and worth saying.

export type Insight = {
  key: string
  // up and down: a change; warn: something to check; info: worth knowing.
  tone: 'up' | 'down' | 'warn' | 'info'
  title: string
  text: string
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function hourName(hour: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve} ${hour < 12 ? 'am' : 'pm'}`
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

function number(n: number): string {
  return n.toLocaleString('en-IN')
}

type Context = {
  stats: Stats
  // Entries in the period, split by crop (or variety) in chart order.
  parts: Part[]
  current: number
  allTime: boolean
  // Days in the period, and what one chart column covers.
  days: number
  columnName: string
  // The name of each chart column, as in "Tue 5 Oct".
  columnNames: string[]
  // True when the period ends today, so "lately" means now.
  endsToday: boolean
  period: string
}

export function insights(c: Context): Insight[] {
  const { stats, current } = c
  const found: Insight[] = []
  const kpis = stats.kpis

  if (current === 0) {
    found.push({
      key: 'none',
      tone: 'info',
      title: 'Nothing has come in yet',
      text: c.allTime
        ? 'Entries appear here as soon as a farmer scans a bag and submits the form.'
        : `No farmer entries arrived in the ${c.period}.`,
    })
  }

  // How this period compares with the one before it.
  if (!c.allTime && current > 0) {
    if (stats.previous === 0) {
      found.push({
        key: 'trend',
        tone: 'up',
        title: `${number(current)} entries, up from none`,
        text: `Nothing came in during the ${c.days} days before this period.`,
      })
    } else {
      const change = Math.round(((current - stats.previous) / stats.previous) * 100)
      if (change !== 0) {
        found.push({
          key: 'trend',
          tone: change > 0 ? 'up' : 'down',
          title: `Entries ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}%`,
          text: `${number(current)} against ${number(stats.previous)} in the ${c.days} days before.`,
        })
      }
    }
  }

  // Lately nothing at all: worth a call to the field.
  if (c.endsToday && current > 0 && c.columnName === 'day') {
    let quiet = 0
    for (let i = stats.columns.length - 1; i >= 0; i--) {
      if (Object.values(stats.columns[i]).some((n) => n > 0)) break
      quiet += 1
    }
    if (quiet >= 3) {
      found.push({
        key: 'quiet',
        tone: 'warn',
        title: `No entries in the last ${quiet} days`,
        text: 'Check that labels are reaching farmers and the form opens on their phones.',
      })
    }
  }

  // Repeat mobile numbers: the same farmer twice, or one phone for many.
  if (kpis && kpis.repeatFarmers > 0) {
    found.push({
      key: 'repeats',
      tone: 'warn',
      title: `${number(kpis.repeatFarmers)} mobile ${kpis.repeatFarmers === 1 ? 'number appears' : 'numbers appear'} more than once`,
      text: 'Either a farmer received seed twice, or one phone was used for several farmers. Search the number on the Farmers page to check.',
    })
  }

  // The leading crop, when there is more than one.
  if (c.parts.length > 1 && current > 0) {
    const lead = [...c.parts].sort((a, b) => b.value - a.value)[0]
    found.push({
      key: 'lead',
      tone: 'info',
      title: `${lead.name} leads with ${percent(lead.value, current)}%`,
      text: `${number(lead.value)} of ${number(current)} entries were for ${lead.name.toLowerCase() === 'other' ? 'other ' + stats.by + 's' : lead.name}.`,
    })
  }

  // The busiest column of the chart.
  if (current > 0 && stats.columns.length > 1) {
    let best = 0
    let bestTotal = 0
    stats.columns.forEach((column, i) => {
      const sum = Object.values(column).reduce((a, b) => a + b, 0)
      if (sum > bestTotal) {
        best = i
        bestTotal = sum
      }
    })
    found.push({
      key: 'peak',
      tone: 'info',
      title: `Busiest ${c.columnName}: ${c.columnNames[best]}`,
      text: `${number(bestTotal)} entries, ${percent(bestTotal, current)}% of the period.`,
    })
  }

  // When in the week and day farmers fill the form in.
  if (current >= 10 && stats.heatmap.length === 7) {
    let day = 0
    let hour = 0
    stats.heatmap.forEach((row, d) =>
      row.forEach((n, h) => {
        if (n > stats.heatmap[day][hour]) {
          day = d
          hour = h
        }
      }),
    )
    found.push({
      key: 'hour',
      tone: 'info',
      title: `Most active: ${DAY_NAMES[day]}s, ${hourName(hour)}`,
      text: 'Field staff are most needed around then; plan visits and support for that time.',
    })
  }

  // Details the office will need later, and how often they are missing.
  if (kpis && current >= 5) {
    const withContact = percent(kpis.withContact, current)
    if (withContact < 80) {
      found.push({
        key: 'contact',
        tone: 'warn',
        title: `Only ${withContact}% of entries have a mobile number`,
        text: 'Farmers without one cannot be reached later. Consider making the number required on the farmer form.',
      })
    }
    const withId = percent(kpis.withId, current)
    if (withId < 50) {
      found.push({
        key: 'kyc',
        tone: 'warn',
        title: `ID numbers on ${withId}% of entries`,
        text: 'Most entries have no Aadhaar, PAN or other ID number.',
      })
    }
  }

  // The busiest distribution channel's share.
  const top = stats.channels[0]
  if (top && current > 0) {
    const sum = Object.values(top.counts).reduce((a, b) => a + b, 0)
    if (stats.channelCount > 1) {
      found.push({
        key: 'channel',
        tone: 'info',
        title: `Top channel handled ${percent(sum, current)}%`,
        text: `${top.name}: ${number(sum)} entries, of ${number(stats.channelCount)} channels with entries.`,
      })
    }
  }

  if (current > 0 && c.days > 1) {
    found.push({
      key: 'average',
      tone: 'info',
      title: `${number(Math.round((current / c.days) * 10) / 10)} entries a day on average`,
      text: kpis && kpis.devices > 0
        ? `From ${number(kpis.devices)} ${kpis.devices === 1 ? 'phone' : 'phones'}, about ${number(Math.round(current / kpis.devices))} entries each.`
        : `Over ${number(c.days)} days.`,
    })
  }

  const unused = stats.lots?.unused ?? 0
  if (unused > 0) {
    found.push({
      key: 'unused',
      tone: 'info',
      title: `${number(unused)} seed ${unused === 1 ? 'lot has' : 'lots have'} not been scanned yet`,
      text: 'Their labels may not have reached the bags, or the bags have not been handed out.',
    })
  }

  // Warnings and changes first, then the rest in the order above.
  const order = { warn: 0, up: 1, down: 1, info: 2 }
  return found
    .map((insight, index) => ({ insight, index }))
    .sort((a, b) => order[a.insight.tone] - order[b.insight.tone] || a.index - b.index)
    .map(({ insight }) => insight)
}
