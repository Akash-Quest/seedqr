import { Fragment, useState } from 'react'
import { DownloadIcon, RefreshIcon, UploadIcon } from '../components/Icons'
import ImportEntries from '../components/ImportEntries'
import PageHeader from '../components/PageHeader'
import { useApi } from '../data/api'
import { DEFAULT_FORMS } from '../data/forms'
import type { FieldSpec, Forms } from '../data/forms'
import { formatDate, formatDateTime } from '../data/types'
import type { ReceivedEntry } from '../data/types'

function documentType(e: ReceivedEntry): string {
  return e.kycType === 'Other' ? e.kycOther || 'Other' : e.kycType
}

// ID numbers are shown shortened on screen. The Excel file has them in full.
function shortened(idNumber: string): string {
  return idNumber.length > 4 ? '••••' + idNumber.slice(-4) : idNumber
}

// Every device detail that appears in any entry, in first-seen order, so
// the spreadsheet gets one column for each.
function deviceLabels(entries: ReceivedEntry[]): string[] {
  const labels = new Set<string>()
  for (const entry of entries) {
    for (const label of Object.keys(entry.device ?? {})) labels.add(label)
  }
  return [...labels]
}

// The questions the office added, so their answers get columns too.
function custom(fields: FieldSpec[]): FieldSpec[] {
  return fields.filter((field) => !field.builtin)
}

async function downloadExcel(entries: ReceivedEntry[], forms: Forms) {
  const columns: [string, (e: ReceivedEntry) => string][] = [
    ['Received', (e) => e.receivedAt],
    ['Filled in', (e) => e.filledAt],
    ['Date', (e) => e.date ?? ''],
    ['Filled by', (e) => e.filledBy],
    ['Farmer name', (e) => e.farmerName],
    ['Document type', documentType],
    ['ID number', (e) => e.idNumber],
    ['Contact number', (e) => e.contact],
    ['Distribution channel', (e) => e.channel],
    ['Landholding size', (e) => e.landholding],
    ['Quantity of seed given', (e) => e.quantity],
    ...custom(forms.farmer).map(
      (field): [string, (e: ReceivedEntry) => string] => [
        field.label,
        (e) => e.extra?.[field.key] ?? '',
      ],
    ),
    ['Crop', (e) => e.lot?.crop ?? ''],
    ['Variety', (e) => e.lot?.variety ?? ''],
    ['Seed type', (e) => e.lot?.seedType ?? ''],
    ['Batch/lot number', (e) => e.lot?.batchNo ?? ''],
    ...custom(forms.lot).map(
      (field): [string, (e: ReceivedEntry) => string] => [
        `Seed: ${field.label}`,
        (e) => e.lot?.extra?.[field.key] ?? '',
      ],
    ),
    ['QR code', (e) => e.lotId],
    ['Device fingerprint', (e) => e.fingerprint],
    ['Device ID', (e) => e.deviceId],
    ['Network address', (e) => e.ipAddress],
    ...deviceLabels(entries).map(
      (label): [string, (e: ReceivedEntry) => string] => [label, (e) => e.device?.[label] ?? ''],
    ),
    ['User agent', (e) => e.userAgent],
  ]
  // Every cell is written as text, so Excel keeps Aadhaar and phone numbers
  // exactly as typed instead of rounding them or dropping leading zeros.
  const header = columns.map(([title]) => ({ value: title, fontWeight: 'bold' as const }))
  const rows = entries.map((e) =>
    columns.map(([, read]) => ({ value: read(e), type: String })),
  )
  const widths = columns.map(([title], index) => ({
    width: Math.min(
      45,
      Math.max(title.length, ...rows.map((row) => row[index].value.length)) + 2,
    ),
  }))

  // Loaded only when the button is pressed, to keep the pages light.
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  await writeExcelFile([header, ...rows], {
    sheet: 'Farmer entries',
    columns: widths,
    stickyRowsCount: 1,
  }).toFile('farmer-entries.xlsx')
}

function Users() {
  const { data, error, reload } = useApi<ReceivedEntry[]>('/entries')
  const forms = useApi<Forms>('/forms').data ?? DEFAULT_FORMS
  const [query, setQuery] = useState('')
  // Date range, as YYYY-MM-DD. Empty means no limit on that side.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const needle = query.trim().toLowerCase()
  const shown = (data ?? []).filter((e) => {
    // The day the entry was received, in this computer's time zone.
    const day = new Date(e.receivedAt).toLocaleDateString('en-CA')
    if (from && day < from) return false
    if (to && day > to) return false
    return (
      needle === '' ||
      [e.farmerName, e.contact, e.channel, e.lot?.crop, e.lot?.batchNo]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  })
  const filtered = needle !== '' || from !== '' || to !== ''

  // Ticked rows. Only ticks on rows that are currently shown count, so a
  // row hidden by the search can never slip into the export unseen.
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const picked = shown.filter((e) => ticked.has(e.id))
  const allPicked = shown.length > 0 && picked.length === shown.length
  // With nothing ticked, the export is everything the filters show.
  const toExport = picked.length > 0 ? picked : shown

  function toggle(id: string) {
    const next = new Set(ticked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setTicked(next)
  }

  function toggleAll() {
    setTicked(allPicked ? new Set() : new Set(shown.map((e) => e.id)))
  }

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Farmers who scanned a seed bag and filled in the form."
      >
        <button type="button" className="secondary" onClick={reload}>
          <RefreshIcon />
          Check for new
        </button>
        <button
          type="button"
          className="secondary"
          aria-expanded={importing}
          onClick={() => setImporting(!importing)}
        >
          <UploadIcon />
          Import from Excel
        </button>
        {data && data.length > 0 && (
          <button
            type="button"
            disabled={toExport.length === 0}
            onClick={() => void downloadExcel(toExport, forms)}
          >
            <DownloadIcon />
            {picked.length > 0
              ? `Export ${picked.length} selected`
              : filtered
                ? `Export ${shown.length} shown`
                : 'Export all to Excel'}
          </button>
        )}
      </PageHeader>

      <div className="page">
        {importing && (
          <ImportEntries
            fields={forms.farmer}
            onImported={reload}
            onClose={() => setImporting(false)}
          />
        )}
        {error ? (
          <p className="problem">{error}</p>
        ) : !data ? (
          <p className="muted">Loading…</p>
        ) : (
          <section className="card">
            <div className="card-head filters">
              <input
                className="search"
                type="search"
                aria-label="Search by name, phone, channel, crop or batch"
                placeholder="Search by name, phone, channel, crop or batch"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="date-filter">
                From
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="date-filter">
                To
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              {filtered && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setQuery('')
                    setFrom('')
                    setTo('')
                  }}
                >
                  Clear
                </button>
              )}
              <p className="filter-count">
                {picked.length > 0 && `${picked.length} selected · `}
                Showing {shown.length} of {data.length}
              </p>
            </div>

            {data.length === 0 ? (
              <p className="empty">
                <strong>Nothing has come in yet</strong>
                Entries appear here when a farmer scans a bag and submits the
                form.
              </p>
            ) : shown.length === 0 ? (
              <p className="empty">
                <strong>No entries match</strong>
                Try a shorter search or a wider date range.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="tick">
                        <input
                          type="checkbox"
                          aria-label="Select all shown entries"
                          checked={allPicked}
                          ref={(box) => {
                            // Shows a dash when only some rows are ticked.
                            if (box) box.indeterminate = picked.length > 0 && !allPicked
                          }}
                          onChange={toggleAll}
                        />
                      </th>
                      <th>Farmer</th>
                      <th>Date</th>
                      <th>Contact</th>
                      <th>Document</th>
                      <th>Seed</th>
                      <th>Batch/lot</th>
                      <th>Quantity</th>
                      <th>Land</th>
                      <th>Distribution channel</th>
                      <th>Filled by</th>
                      <th>Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <Fragment key={e.id}>
                      <tr className={ticked.has(e.id) ? 'picked' : ''}>
                        <td className="tick">
                          <input
                            type="checkbox"
                            aria-label={`Select ${e.farmerName}`}
                            checked={ticked.has(e.id)}
                            onChange={() => toggle(e.id)}
                          />
                        </td>
                        <td>
                          <strong>{e.farmerName}</strong>
                          {/* Under the name, so it is reachable without
                              scrolling the wide table sideways. */}
                          <button
                            type="button"
                            className="link-button small"
                            aria-expanded={openId === e.id}
                            onClick={() => setOpenId(openId === e.id ? null : e.id)}
                          >
                            {openId === e.id ? 'Hide details' : 'Show details'}
                          </button>
                        </td>
                        <td>{formatDate(e.date ?? '')}</td>
                        <td className="mono">{e.contact}</td>
                        <td>
                          {documentType(e)}
                          {e.idNumber && (
                            <span className="mono"> {shortened(e.idNumber)}</span>
                          )}
                        </td>
                        <td>{e.lot ? `${e.lot.crop}, ${e.lot.variety}` : ''}</td>
                        <td className="mono">{e.lot?.batchNo}</td>
                        <td>{e.quantity}</td>
                        <td>{e.landholding}</td>
                        <td className="wrap">{e.channel}</td>
                        <td>{e.filledBy}</td>
                        <td>{formatDateTime(e.receivedAt)}</td>
                      </tr>
                      {openId === e.id && (
                        <tr className="detail-row">
                          <td colSpan={12}>
                            <OtherAnswers entry={e} fields={custom(forms.farmer)} />
                            <DeviceDetails entry={e} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  )
}

// Everything recorded about the phone an entry came from.
// Answers to the questions the office added to the farmer form.
function OtherAnswers({ entry, fields }: { entry: ReceivedEntry; fields: FieldSpec[] }) {
  const known = fields
    .map((field) => [field.label, entry.extra?.[field.key] ?? ''] as const)
    .filter(([, value]) => value)
  if (known.length === 0) return null
  return (
    <>
      <h3>Other answers</h3>
      <dl className="details gap-below">
        {known.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

function DeviceDetails({ entry }: { entry: ReceivedEntry }) {
  const rows: [string, string][] = [
    ['Device fingerprint', entry.fingerprint],
    ['Device ID', entry.deviceId],
    ['Network address', entry.ipAddress],
    ...Object.entries(entry.device ?? {}),
    ['Filled in on the phone at', formatDateTime(entry.filledAt)],
    ['User agent', entry.userAgent],
  ]
  const known = rows.filter(([, value]) => value)

  return (
    <>
      <h3>Device details</h3>
      {known.length === 0 ? (
        <p className="muted">Nothing was recorded for this entry.</p>
      ) : (
        <dl className="details">
          {known.map(([label, value]) => (
            <div key={label} className={label === 'User agent' ? 'full' : ''}>
              <dt>{label}</dt>
              <dd className={/fingerprint|ID|address|agent/.test(label) ? 'mono' : ''}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  )
}

export default Users
