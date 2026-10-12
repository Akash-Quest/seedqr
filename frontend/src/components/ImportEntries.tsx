import { useMemo, useState } from 'react'
import type { Row } from 'read-excel-file/browser'
import { api, useApi } from '../data/api'
import { newId } from '../data/device'
import type { FieldSpec } from '../data/forms'
import type { FarmerEntry, KycType, SeedLot } from '../data/types'
import Field from './Field'
import { CloseIcon } from './Icons'

type ImportEntriesProps = {
  // The farmer form's questions, as the office set them up.
  fields: FieldSpec[]
  // The seed details form's questions, for files that carry seed details.
  lotFields: FieldSpec[]
  onImported: () => void
  onClose: () => void
}

// The seed details written on a row, for files that have them in place of a
// QR code. The server finds the seed lot they describe, or makes it.
type Seed = {
  crop: string
  variety: string
  batchNo: string
  seedType: string
  productionSource: string
  certification: string
  expiryDate: string
  storageLocation: string
  packingLocation: string
  // The earliest day this seed appears in the file.
  date: string
}

// An entry before it is sent.
type Draft = Omit<FarmerEntry, 'id'> & {
  // Set for rows that say when they were made. The same row then always
  // gets the same ID, so importing a file twice adds nothing.
  id?: string
  seed?: Seed
  receivedAt?: string
}

type Problem = { row: number; text: string }

// Rows sent to the server in one go. Same as the backend's limit.
const BATCH = 5000
const MAX_SHOWN_PROBLEMS = 10
const NO_LOTS: SeedLot[] = []

// Column titles for the built-in questions, the same as in the exported file.
const TITLES: Record<string, string> = {
  date: 'Date',
  filledBy: 'Filled by',
  farmerName: 'Farmer name',
  kycType: 'Document type',
  idNumber: 'ID number',
  contact: 'Contact number',
  channel: 'Distribution channel',
  landholding: 'Landholding size',
  quantity: 'Quantity of seed given',
}
const QR_TITLE = 'QR code'
// When the entry was made: "Timestamp" in sheets kept by hand, "Received"
// in this app's own export.
const TIME_TITLES = ['Timestamp', 'Received']

// Column titles for the seed details, by the seed lot's own field names.
const SEED_TITLES: Record<Exclude<keyof Seed, 'date'>, string[]> = {
  crop: ['Crop intended for sowing', 'Crop'],
  variety: ['Variety'],
  batchNo: ['Batch/lot number', 'Batch/lot', 'Batch'],
  seedType: ['Seed type'],
  productionSource: ['Production source'],
  certification: ['Certification details', 'Certification'],
  expiryDate: ['Expiry date'],
  storageLocation: ['Storage location'],
  packingLocation: ['Packing location'],
}
const SEED_KEYS = Object.keys(SEED_TITLES) as Exclude<keyof Seed, 'date'>[]

// The longest answer the backend accepts for each column.
const LIMITS: Record<string, number> = {
  farmerName: 300,
  kycType: 300,
  idNumber: 40,
  contact: 20,
  channel: 300,
  landholding: 300,
  quantity: 300,
}

const number = (n: number) => n.toLocaleString('en-IN')

function text(cell: Row[number] | undefined): string {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return cell.toISOString().slice(0, 10)
  return String(cell).trim()
}

// Accepts 2026-10-09, or day first as usually typed: 9/10/2026, 09-10-2026.
// Returns null when the text is not a date.
function isoDate(value: string): string | null {
  if (value === '') return ''
  const yearFirst = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const dayFirst = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  const parts = yearFirst
    ? [yearFirst[1], yearFirst[2], yearFirst[3]]
    : dayFirst
      ? [dayFirst[3], dayFirst[2], dayFirst[1]]
      : null
  if (!parts) return null
  const [year, month, day] = parts.map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  // 31/02 would otherwise quietly become a day in March.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

// The exact moment a time cell means. Excel keeps a time as it reads on the
// clock on the wall, with no time zone, and it arrives here as if that
// clock were UTC. It was this office's clock, which is this computer's.
function moment(cell: Row[number] | undefined): string {
  if (cell instanceof Date) {
    return new Date(
      cell.getUTCFullYear(),
      cell.getUTCMonth(),
      cell.getUTCDate(),
      cell.getUTCHours(),
      cell.getUTCMinutes(),
      cell.getUTCSeconds(),
    ).toISOString()
  }
  // This app's own export writes the full time, zone included.
  const written = text(cell)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(written)) return ''
  const time = new Date(written)
  return Number.isNaN(time.getTime()) ? '' : time.toISOString()
}

function documentType(value: string): [KycType, string] {
  if (value === '') return ['', '']
  // Spelt both ways in the field: Aadhaar, Aadhar, Adhaar, Adhar.
  if (/^a{1,2}dha{1,2}r/i.test(value)) return ['Aadhaar ID', '']
  if (/^pan\b/i.test(value)) return ['PAN ID', '']
  return ['Other', /^other$/i.test(value) ? '' : value]
}

// Two rows are the same seed when these match, whatever the capitals and
// spacing. The server decides the same way.
function seedKey(seed: Pick<Seed, 'crop' | 'variety' | 'batchNo'>): string {
  return [seed.crop, seed.variety, seed.batchNo]
    .map((part) => part.split(/\s+/).join(' ').toLowerCase())
    .join('|')
}

// A short fingerprint of some text (cyrb53). Not secret, only steady: the
// same text always gives the same result.
function fingerprint(value: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

type Reading = {
  // The file as a whole cannot be used.
  fileProblem?: string
  drafts: Draft[]
  // Rows that cannot be imported as they are.
  problems: Problem[]
  // The seed lots the rows describe, for files with seed details.
  seeds: { name: string; rows: number }[]
  // Rows that say the same as an earlier row, kept once.
  repeats: number
}

// Turns the sheet into entries, and lists the rows that have to be fixed.
function readRows(
  sheet: Row[],
  fields: FieldSpec[],
  lotFields: FieldSpec[],
  lots: SeedLot[],
  fallbackLot: string,
): Reading {
  const titles = new Map<string, number>()
  ;(sheet[0] ?? []).forEach((cell, index) => {
    const title = text(cell).toLowerCase()
    if (title && !titles.has(title)) titles.set(title, index)
  })
  // A column is found by its usual title or by the office's own name for
  // the question. Failing that, by a title that starts with one of them:
  // "Seed type (hybrid, certified…)" is the "Seed type" column.
  const column = (...names: (string | undefined)[]) => {
    const wanted = names.filter((name): name is string => !!name).map((name) => name.toLowerCase())
    for (const name of wanted) {
      const exact = titles.get(name)
      if (exact !== undefined) return exact
    }
    for (const name of wanted) {
      for (const [title, index] of titles) if (title.startsWith(name)) return index
    }
    return undefined
  }

  const columns: Record<string, number | undefined> = {
    qr: column(QR_TITLE),
    time: column(...TIME_TITLES),
  }
  for (const field of fields) {
    columns[field.key] = field.builtin
      ? column(TITLES[field.key], field.label)
      : column(field.label)
  }
  if (columns.farmerName === undefined) {
    return {
      fileProblem:
        'The first row has no “Farmer name” column. Download the template to see the column titles.',
      drafts: [],
      problems: [],
      seeds: [],
      repeats: 0,
    }
  }
  const seedColumns = {} as Record<Exclude<keyof Seed, 'date'>, number | undefined>
  for (const key of SEED_KEYS) {
    const label = lotFields.find((field) => field.key === key)?.label
    seedColumns[key] = column(...SEED_TITLES[key], label)
  }
  // Seed details are only used when they can name a seed lot.
  const hasSeed =
    seedColumns.crop !== undefined &&
    seedColumns.variety !== undefined &&
    seedColumns.batchNo !== undefined

  const known = new Set(lots.map((lot) => lot.id))
  const custom = fields.filter((field) => !field.builtin)
  const drafts: Draft[] = []
  const problems: Problem[] = []
  const seeds = new Map<string, { seed: Seed; rows: number }>()
  const ids = new Set<string>()
  let repeats = 0

  sheet.slice(1).forEach((row, index) => {
    if (row.every((cell) => text(cell) === '')) return
    // The row number as Excel shows it.
    const where = index + 2
    const found: string[] = []
    const cell = (at: number | undefined) => (at === undefined ? '' : text(row[at]))

    const answers: Record<string, string> = {}
    for (const key of Object.keys(TITLES)) answers[key] = cell(columns[key])
    answers.idNumber = answers.idNumber.replace(/[\s,-]/g, '').toUpperCase()
    // A phone number is its digits. "." and the like mean none was given.
    answers.contact = /\d/.test(answers.contact) ? answers.contact.replace(/\s/g, '') : ''

    if (!answers.farmerName) found.push('the farmer name is missing.')
    for (const [key, limit] of Object.entries(LIMITS)) {
      if (answers[key].length > limit)
        found.push(`“${TITLES[key]}” is longer than ${limit} characters.`)
    }

    const receivedAt = columns.time === undefined ? '' : moment(row[columns.time])
    // With no "Date" column, the day comes from the time.
    const date = columns.date === undefined ? cell(columns.time).slice(0, 10) : answers.date
    const day = isoDate(date)
    if (day === null) found.push(`“${date}” is not a date. Write it like 09/10/2026.`)

    const qr = cell(columns.qr).toUpperCase()
    let lotId = ''
    let seed: Seed | undefined
    if (qr) {
      lotId = qr
      if (!known.has(qr)) found.push(`QR code “${qr}” is not recognised.`)
    } else if (hasSeed) {
      const details = { date: day ?? '' } as Seed
      for (const key of SEED_KEYS) details[key] = cell(seedColumns[key])
      // The server wants a date or nothing here.
      details.expiryDate = isoDate(details.expiryDate) ?? ''
      if (!details.crop || !details.variety || !details.batchNo) {
        found.push('the crop, variety or batch/lot number is missing.')
      } else {
        const key = seedKey(details)
        seed = seeds.get(key)?.seed
        if (!seed) {
          seed = details
          seeds.set(key, { seed, rows: 0 })
        } else if (details.date && (!seed.date || details.date < seed.date)) {
          // Shared by every row of this seed, so all carry the earliest day.
          seed.date = details.date
        }
      }
    } else if (fallbackLot) {
      lotId = fallbackLot
      if (!known.has(lotId)) found.push(`QR code “${lotId}” is not recognised.`)
    } else {
      found.push('there is no QR code. Choose a seed lot above.')
    }

    const extra: Record<string, string> = {}
    for (const field of custom) {
      const value = cell(columns[field.key])
      if (field.type === 'number' && value && !Number.isFinite(Number(value)))
        found.push(`“${field.label}” must be a number.`)
      if (value) extra[field.key] = value
    }

    if (found.length > 0) {
      for (const problem of found) problems.push({ row: where, text: problem })
      return
    }

    let id: string | undefined
    if (receivedAt) {
      // Who, when and which seed. A second row saying the same is a repeat.
      const said = JSON.stringify([
        receivedAt,
        answers.farmerName.toLowerCase(),
        answers.idNumber,
        answers.contact,
        seed ? seedKey(seed) : lotId,
      ])
      id = `xl-${fingerprint(said, 1)}${fingerprint(said, 2)}`
      if (ids.has(id)) {
        repeats++
        return
      }
      ids.add(id)
    }
    if (seed) seeds.get(seedKey(seed))!.rows++

    const [kycType, kycOther] = documentType(answers.kycType)
    drafts.push({
      id,
      lotId,
      seed,
      receivedAt: receivedAt || undefined,
      date: day ?? '',
      filledBy: /officer/i.test(answers.filledBy) ? 'Field officer' : 'Farmer',
      farmerName: answers.farmerName,
      kycType,
      kycOther,
      idNumber: answers.idNumber,
      contact: answers.contact,
      channel: answers.channel,
      landholding: answers.landholding,
      quantity: answers.quantity,
      filledAt: '',
      deviceId: '',
      fingerprint: '',
      userAgent: '',
      // Shown with the entry's details, so it is clear no phone sent it.
      device: { Source: 'Excel import' },
      extra,
    })
  })

  return {
    drafts,
    problems,
    repeats,
    seeds: [...seeds.values()]
      .filter((item) => item.rows > 0)
      .map(({ seed, rows }) => ({
        name: `${seed.crop}, ${seed.variety} · ${seed.batchNo}`,
        rows,
      }))
      .sort((a, b) => b.rows - a.rows),
  }
}

async function downloadTemplate(fields: FieldSpec[]) {
  const titles = [
    ...Object.values(TITLES),
    ...fields.filter((field) => !field.builtin).map((field) => field.label),
    QR_TITLE,
  ]
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  await writeExcelFile([titles.map((value) => ({ value, fontWeight: 'bold' as const }))], {
    sheet: 'Farmer entries',
    columns: titles.map((title) => ({ width: title.length + 4 })),
    stickyRowsCount: 1,
  }).toFile('farmer-entries-template.xlsx')
}

type Status = {
  error?: string
  // Rows sent so far, while an import is running.
  sent?: number
  // Set when an import has finished.
  done?: { saved: number; already: number; lotsMade: number }
}

// Lets the office add many entries at once from an Excel file.
function ImportEntries({ fields, lotFields, onImported, onClose }: ImportEntriesProps) {
  const lotsReply = useApi<SeedLot[]>('/lots')
  const lots = lotsReply.data ?? NO_LOTS
  const [sheet, setSheet] = useState<Row[] | null>(null)
  const [lotId, setLotId] = useState('')
  // Leave out the rows that have problems and import the rest.
  const [skipping, setSkipping] = useState(false)
  const [status, setStatus] = useState<Status>({})
  const [busy, setBusy] = useState(false)
  // Changed after an import to empty the file box.
  const [fileBox, setFileBox] = useState(0)

  // A big file takes a moment to read, so only when something changed.
  const result = useMemo(
    () => (sheet ? readRows(sheet, fields, lotFields, lots, lotId) : null),
    [sheet, fields, lotFields, lots, lotId],
  )
  const badRows = result ? new Set(result.problems.map((problem) => problem.row)).size : 0
  const ready =
    result !== null &&
    !result.fileProblem &&
    result.drafts.length > 0 &&
    (badRows === 0 || skipping)

  async function choose(file: File | undefined) {
    setStatus({})
    setSheet(null)
    setSkipping(false)
    if (!file) return
    try {
      // Loaded only when a file is chosen, to keep the pages light.
      const { readSheet } = await import('read-excel-file/browser')
      setSheet(await readSheet(file))
    } catch {
      setStatus({
        error: 'This file could not be read. Save it as an Excel workbook (.xlsx) and try again.',
      })
    }
  }

  async function submit() {
    if (!result || !ready) return
    const rows = result.drafts
    setBusy(true)
    setStatus({ sent: 0 })
    let saved = 0
    let lotsMade = 0
    let sent = 0
    try {
      // A few thousand at a time, so a very long file never has to go, or
      // be saved, in one piece.
      for (; sent < rows.length; sent += BATCH) {
        const reply = await api<{ count: number; lotsMade?: number }>(
          '/entries/import',
          rows.slice(sent, sent + BATCH).map((draft) => ({ ...draft, id: draft.id ?? newId() })),
        )
        saved += reply.count
        lotsMade += reply.lotsMade ?? 0
        setStatus({ sent: Math.min(sent + BATCH, rows.length) })
      }
      setSheet(null)
      setFileBox(fileBox + 1)
      setStatus({ done: { saved, already: rows.length - saved, lotsMade } })
    } catch (err) {
      setStatus({
        error:
          sent === 0
            ? (err as Error).message
            : `${(err as Error).message} The first ${number(sent)} rows were saved. Choose the file again to carry on.`,
      })
    }
    if (saved > 0) {
      onImported()
      lotsReply.reload()
    }
    setBusy(false)
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Import from Excel</h2>
          <p>Each row becomes one entry. The first row must hold the column titles.</p>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div className="card-body form-grid">
        <Field
          id="importFile"
          label="Excel file"
          hint="An .xlsx file with the same column titles as the export, or with the seed details on every row."
        >
          <input
            key={fileBox}
            id="importFile"
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </Field>
        <Field
          id="importLot"
          label="Seed lot"
          hint="Used for rows with no QR code and no seed details."
        >
          <select
            id="importLot"
            value={lotId}
            disabled={busy}
            onChange={(e) => setLotId(e.target.value)}
          >
            <option value="">Choose…</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.crop}, {lot.variety} · {lot.batchNo} ({lot.id})
              </option>
            ))}
          </select>
        </Field>

        {result?.fileProblem && (
          <div className="problem full" role="alert">
            <p>
              <strong>{result.fileProblem}</strong>
            </p>
          </div>
        )}

        {result && badRows > 0 && (
          <div className="problem full" role="alert">
            <p>
              <strong>
                {badRows === 1 ? '1 row has' : `${number(badRows)} rows have`} a problem.
              </strong>{' '}
              Fix {badRows === 1 ? 'it' : 'them'} in the file and choose it again, or leave{' '}
              {badRows === 1 ? 'it' : 'them'} out.
            </p>
            <ul>
              {result.problems.slice(0, MAX_SHOWN_PROBLEMS).map((problem) => (
                <li key={`${problem.row} ${problem.text}`}>
                  Row {number(problem.row)}: {problem.text}
                </li>
              ))}
            </ul>
            {result.problems.length > MAX_SHOWN_PROBLEMS && (
              <p>And {number(result.problems.length - MAX_SHOWN_PROBLEMS)} more.</p>
            )}
            {result.drafts.length > 0 && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={skipping}
                  disabled={busy}
                  onChange={(e) => setSkipping(e.target.checked)}
                />
                Leave {badRows === 1 ? 'this row' : `these ${number(badRows)} rows`} out and
                import the other {number(result.drafts.length)}
              </label>
            )}
          </div>
        )}

        {result && !result.fileProblem && result.seeds.length > 0 && (
          <div className="full">
            <p className="muted">
              The rows carry their own seed details. Each of these seed lots is used if it is
              already here, and made if it is not:
            </p>
            <ul>
              {result.seeds.map((seed) => (
                <li key={seed.name}>
                  {seed.name}: {number(seed.rows)} {seed.rows === 1 ? 'row' : 'rows'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card-foot">
        <button type="button" className="link-button" onClick={() => void downloadTemplate(fields)}>
          Download a template
        </button>
        <p className="grow" role="status">
          {status.error ? (
            <span className="error">{status.error}</span>
          ) : status.done ? (
            [
              `Imported ${number(status.done.saved)} ${status.done.saved === 1 ? 'entry' : 'entries'}.`,
              status.done.already > 0 &&
                `${number(status.done.already)} ${status.done.already === 1 ? 'was' : 'were'} already here.`,
              status.done.lotsMade > 0 &&
                `Made ${number(status.done.lotsMade)} seed ${status.done.lotsMade === 1 ? 'lot' : 'lots'}.`,
            ]
              .filter(Boolean)
              .join(' ')
          ) : busy && result ? (
            `Importing: ${number(status.sent ?? 0)} of ${number(result.drafts.length)} sent. Keep this page open.`
          ) : ready ? (
            [
              `${number(result.drafts.length)} ${result.drafts.length === 1 ? 'row is' : 'rows are'} ready to import.`,
              result.repeats > 0 &&
                `${number(result.repeats)} repeated ${result.repeats === 1 ? 'row is' : 'rows are'} counted once.`,
            ]
              .filter(Boolean)
              .join(' ')
          ) : result && !result.fileProblem && badRows === 0 ? (
            'The file has no rows under the column titles.'
          ) : (
            ''
          )}
        </p>
        <button type="button" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? 'Importing…' : ready ? `Import ${number(result.drafts.length)}` : 'Import'}
        </button>
      </div>
    </section>
  )
}

export default ImportEntries
