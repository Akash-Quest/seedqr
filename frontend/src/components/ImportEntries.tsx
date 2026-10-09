import { useState } from 'react'
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
  onImported: () => void
  onClose: () => void
}

// An entry before it is sent. Its ID is made up when Import is pressed.
type Draft = Omit<FarmerEntry, 'id'>

// Same as the backend's limit.
const MAX_ROWS = 5000
const MAX_SHOWN_PROBLEMS = 10

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

function documentType(value: string): [KycType, string] {
  if (value === '') return ['', '']
  if (/^aadha?ar/i.test(value)) return ['Aadhaar ID', '']
  if (/^pan\b/i.test(value)) return ['PAN ID', '']
  return ['Other', /^other$/i.test(value) ? '' : value]
}

// Turns the sheet into entries, or lists what has to be fixed first.
function readRows(
  sheet: Row[],
  fields: FieldSpec[],
  lots: SeedLot[],
  fallbackLot: string,
): { drafts: Draft[]; problems: string[] } {
  const titles = new Map<string, number>()
  ;(sheet[0] ?? []).forEach((cell, index) => {
    const title = text(cell).toLowerCase()
    if (title && !titles.has(title)) titles.set(title, index)
  })
  // A built-in column is found by its usual title or by the office's own
  // name for the question.
  const column = (...names: string[]) =>
    names.map((name) => titles.get(name.toLowerCase())).find((index) => index !== undefined)
  const columns: Record<string, number | undefined> = { qr: column(QR_TITLE) }
  for (const field of fields) {
    columns[field.key] = field.builtin
      ? column(TITLES[field.key] ?? field.label, field.label)
      : column(field.label)
  }
  if (columns.farmerName === undefined) {
    return {
      drafts: [],
      problems: [
        'The first row has no “Farmer name” column. Download the template to see the column titles.',
      ],
    }
  }

  const known = new Set(lots.map((lot) => lot.id))
  const custom = fields.filter((field) => !field.builtin)
  const drafts: Draft[] = []
  const problems: string[] = []

  sheet.slice(1).forEach((row, index) => {
    if (row.every((cell) => text(cell) === '')) return
    // The row number as Excel shows it.
    const where = `Row ${index + 2}`
    const get = (key: string) => {
      const at = columns[key]
      return at === undefined ? '' : text(row[at])
    }

    const farmerName = get('farmerName')
    if (!farmerName) problems.push(`${where}: the farmer name is missing.`)
    for (const [key, limit] of Object.entries(LIMITS)) {
      if (get(key).length > limit)
        problems.push(`${where}: “${TITLES[key]}” is longer than ${limit} characters.`)
    }

    const date = isoDate(get('date'))
    if (date === null)
      problems.push(`${where}: “${get('date')}” is not a date. Write it like 09/10/2026.`)

    const lotId = get('qr').toUpperCase() || fallbackLot
    if (!lotId) problems.push(`${where}: there is no QR code. Choose a seed lot above.`)
    else if (!known.has(lotId)) problems.push(`${where}: QR code “${lotId}” is not recognised.`)

    const extra: Record<string, string> = {}
    for (const field of custom) {
      const value = get(field.key)
      if (field.type === 'number' && value && !Number.isFinite(Number(value)))
        problems.push(`${where}: “${field.label}” must be a number.`)
      if (value) extra[field.key] = value
    }

    const [kycType, kycOther] = documentType(get('kycType'))
    drafts.push({
      lotId,
      date: date ?? '',
      filledBy: /officer/i.test(get('filledBy')) ? 'Field officer' : 'Farmer',
      farmerName,
      kycType,
      kycOther,
      idNumber: get('idNumber').replace(/\s/g, '').toUpperCase(),
      contact: get('contact'),
      channel: get('channel'),
      landholding: get('landholding'),
      quantity: get('quantity'),
      filledAt: '',
      deviceId: '',
      fingerprint: '',
      userAgent: '',
      // Shown with the entry's details, so it is clear no phone sent it.
      device: { Source: 'Excel import' },
      extra,
    })
  })

  if (drafts.length > MAX_ROWS)
    problems.unshift(`The file has ${drafts.length} rows. At most ${MAX_ROWS} can be imported at once.`)
  return { drafts, problems }
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

// Lets the office add many entries at once from an Excel file.
function ImportEntries({ fields, onImported, onClose }: ImportEntriesProps) {
  const lots = useApi<SeedLot[]>('/lots').data ?? []
  const [sheet, setSheet] = useState<Row[] | null>(null)
  const [lotId, setLotId] = useState('')
  const [status, setStatus] = useState<{ error?: string; imported?: number }>({})
  const [busy, setBusy] = useState(false)
  // Changed after an import to empty the file box.
  const [fileBox, setFileBox] = useState(0)

  const result = sheet ? readRows(sheet, fields, lots, lotId) : null
  const ready = result !== null && result.problems.length === 0 && result.drafts.length > 0

  async function choose(file: File | undefined) {
    setStatus({})
    setSheet(null)
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
    setBusy(true)
    try {
      const { count } = await api<{ count: number }>(
        '/entries/import',
        result.drafts.map((draft) => ({ ...draft, id: newId() })),
      )
      setSheet(null)
      setFileBox(fileBox + 1)
      setStatus({ imported: count })
      onImported()
    } catch (err) {
      setStatus({ error: (err as Error).message })
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
          hint="An .xlsx file with the same column titles as the export."
        >
          <input
            key={fileBox}
            id="importFile"
            type="file"
            accept=".xlsx"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </Field>
        <Field
          id="importLot"
          label="Seed lot"
          hint="Used for rows with nothing in the “QR code” column."
        >
          <select id="importLot" value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">Choose…</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.crop}, {lot.variety} · {lot.batchNo} ({lot.id})
              </option>
            ))}
          </select>
        </Field>

        {result && result.problems.length > 0 && (
          <div className="problem full" role="alert">
            <p>
              <strong>Fix these in the file, then choose it again. Nothing was imported.</strong>
            </p>
            <ul>
              {result.problems.slice(0, MAX_SHOWN_PROBLEMS).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            {result.problems.length > MAX_SHOWN_PROBLEMS && (
              <p>And {result.problems.length - MAX_SHOWN_PROBLEMS} more.</p>
            )}
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
          ) : status.imported !== undefined ? (
            `Imported ${status.imported} ${status.imported === 1 ? 'entry' : 'entries'}.`
          ) : ready ? (
            `${result.drafts.length} ${result.drafts.length === 1 ? 'row is' : 'rows are'} ready to import.`
          ) : result && result.problems.length === 0 ? (
            'The file has no rows under the column titles.'
          ) : (
            ''
          )}
        </p>
        <button type="button" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? 'Importing…' : ready ? `Import ${result.drafts.length}` : 'Import'}
        </button>
      </div>
    </section>
  )
}

export default ImportEntries
