import { Fragment, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  EditIcon,
  RefreshIcon,
  TrashIcon,
  UploadIcon,
} from '../components/Icons'
import EntryEditor from '../components/EntryEditor'
import ImportEntries from '../components/ImportEntries'
import PageHeader from '../components/PageHeader'
import { PageSkeleton } from '../components/Skeleton'
import { api, canEdit, currentToken, useApi } from '../data/api'
import { toast } from '../data/toast'
import { DEFAULT_FORMS } from '../data/forms'
import type { FieldSpec, Forms } from '../data/forms'
import { formatDate, formatDateTime } from '../data/types'
import type { EntryPage, ReceivedEntry } from '../data/types'

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
  toast(`Saved ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} to an Excel file`)
}

// Rows on one page of the table.
const PAGE_SIZE = 100

// The start of a day (YYYY-MM-DD) on this computer's clock, as the exact
// time the server understands. `add` moves it on by that many days.
function dayStart(day: string, add = 0): string {
  const date = new Date(day + 'T00:00:00')
  date.setDate(date.getDate() + add)
  return date.toISOString()
}

type Filters = { q: string; from: string; to: string }

// Every entry that matches, as a file. The browser sends this form itself
// and saves the answer straight to disk, so a very long list never has to
// fit in the page's memory.
function exportMatching(filters: Filters) {
  const form = document.createElement('form')
  form.method = 'post'
  form.action = '/api/entries/export'
  const fields = { token: currentToken(), ...filters }
  for (const [name, value] of Object.entries(fields)) {
    if (!value) continue
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  form.submit()
  form.remove()
  toast('Your download has started. A long list can take a minute.', 'info')
}

function Users() {
  // A search can arrive in the address, from the search box at the top
  // (Ctrl+K), as /users?q=…
  const [params] = useSearchParams()
  const asked = params.get('q')
  const [query, setQuery] = useState(() => asked ?? '')
  // What is searched for: the box's text, once typing has paused.
  const [needle, setNeedle] = useState(() => (asked ?? '').trim())
  const searchBox = useRef<HTMLInputElement>(null)
  // Date range, as YYYY-MM-DD. Empty means no limit on that side.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const tableCard = useRef<HTMLElement>(null)

  // Previous and Next sit under the table, so the new page would otherwise
  // open at its last rows. This brings its first rows into view.
  function goToPage(next: number) {
    setPage(next)
    tableCard.current?.scrollIntoView({ block: 'start' })
  }
  const [openId, setOpenId] = useState<string | null>(null)
  // The entry being corrected, if any.
  const [editId, setEditId] = useState<string | null>(null)
  // The entry whose delete button was pressed and is waiting for a yes or no.
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleteFailure, setDeleteFailure] = useState('')
  const wantsImport = canEdit() && params.has('import')
  const [importing, setImporting] = useState(wantsImport)

  // Asked for again from the search box while this page is already open:
  // noticed while drawing, so the page draws once more straight away.
  const [lastAsked, setLastAsked] = useState({ q: asked, importing: wantsImport })
  if (lastAsked.q !== asked || lastAsked.importing !== wantsImport) {
    setLastAsked({ q: asked, importing: wantsImport })
    if (asked !== null && asked !== lastAsked.q) setQuery(asked)
    if (wantsImport && !lastAsked.importing) setImporting(true)
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setNeedle(query.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  // "/" jumps to the search box, as on many sites.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (event.key !== '/' || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      event.preventDefault()
      searchBox.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The days are the ones on this computer's clock.
  const filters: Filters = {
    q: needle,
    from: from ? dayStart(from) : '',
    to: to ? dayStart(to, 1) : '',
  }
  const search = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) })
  for (const [name, value] of Object.entries(filters)) if (value) search.set(name, value)

  const { data, error, reload, loading, fresh } = useApi<EntryPage>(`/entries?${search}`)
  const forms = useApi<Forms>('/forms').data ?? DEFAULT_FORMS

  const shown = data?.items ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const first = (page - 1) * PAGE_SIZE + 1
  const filtered = needle !== '' || from !== '' || to !== ''
  const number = (n: number) => n.toLocaleString('en-IN')

  // Ticked rows. Only ticks on rows that are currently shown count, so a
  // row on another page can never slip into the export unseen.
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const picked = shown.filter((e) => ticked.has(e.id))
  const allPicked = shown.length > 0 && picked.length === shown.length

  function toggle(id: string) {
    const next = new Set(ticked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setTicked(next)
  }

  function toggleAll() {
    setTicked(allPicked ? new Set() : new Set(shown.map((e) => e.id)))
  }

  async function remove(id: string) {
    try {
      await api(`/entries/${encodeURIComponent(id)}`, undefined, 'DELETE')
      setConfirmId(null)
      toast('Entry deleted')
      reload()
    } catch (err) {
      setDeleteFailure((err as Error).message)
    }
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
        {canEdit() && (
          <button
            type="button"
            className="secondary"
            aria-expanded={importing}
            onClick={() => setImporting(!importing)}
          >
            <UploadIcon />
            Import from Excel
          </button>
        )}
        {picked.length > 0 ? (
          <button type="button" onClick={() => void downloadExcel(picked, forms)}>
            <DownloadIcon />
            Export {picked.length} selected
          </button>
        ) : (
          canEdit() &&
          total > 0 && (
            <button type="button" onClick={() => exportMatching(filters)}>
              <DownloadIcon />
              {filtered ? `Export ${number(total)} matching` : 'Export all'}
            </button>
          )
        )}
      </PageHeader>

      <div className="page">
        {importing && (
          <ImportEntries
            fields={forms.farmer}
            lotFields={forms.lot}
            onImported={reload}
            onClose={() => setImporting(false)}
          />
        )}
        {error ? (
          <p className="problem">{error}</p>
        ) : !data ? (
          <PageSkeleton />
        ) : (
          <section
            className={`card entries-card${loading || !fresh ? ' stale' : ''}`}
            ref={tableCard}
            aria-busy={loading || !fresh}
          >
            <div className="card-head filters">
              <input
                ref={searchBox}
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
                  onChange={(e) => {
                    setFrom(e.target.value)
                    setPage(1)
                  }}
                />
              </label>
              <label className="date-filter">
                To
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => {
                    setTo(e.target.value)
                    setPage(1)
                  }}
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
                    setPage(1)
                  }}
                >
                  Clear
                </button>
              )}
              <div className="filter-count">
                <p>
                  {picked.length > 0 && `${picked.length} selected · `}
                  {total === 0
                    ? 'Showing 0'
                    : `Showing ${number(first)} to ${number(first + shown.length - 1)} of ${number(total)}`}
                </p>
                {/* The same as Previous and Next under the table, within
                    reach without scrolling down. */}
                {pages > 1 && (
                  <>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Previous page"
                      title="Previous page"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeftIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Next page"
                      title="Next page"
                      disabled={page >= pages}
                      onClick={() => setPage(page + 1)}
                    >
                      <ChevronRightIcon />
                    </button>
                  </>
                )}
              </div>
            </div>

            {total === 0 && !filtered ? (
              <p className="empty">
                <strong>Nothing has come in yet</strong>
                Entries appear here when a farmer scans a bag and submits the
                form.
              </p>
            ) : total === 0 ? (
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
                          aria-label="Select all entries on this page"
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
                      <th>
                        <span className="visually-hidden">Actions</span>
                      </th>
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
                        <td className="clip" title={e.channel}>
                          {e.channel}
                        </td>
                        <td>{e.filledBy}</td>
                        <td>{formatDateTime(e.receivedAt)}</td>
                        {confirmId === e.id ? (
                          <td className="row-actions">
                            <span className={deleteFailure ? 'error' : ''}>
                              {deleteFailure || 'Delete this entry for good?'}
                            </span>
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => setConfirmId(null)}
                            >
                              Keep
                            </button>
                            <button
                              type="button"
                              className="link-button danger"
                              onClick={() => void remove(e.id)}
                            >
                              Yes, delete
                            </button>
                          </td>
                        ) : (
                          <td className="row-actions">
                            <button
                              type="button"
                              className="link-button"
                              aria-expanded={openId === e.id}
                              onClick={() => setOpenId(openId === e.id ? null : e.id)}
                            >
                              {openId === e.id ? 'Hide details' : 'Show details'}
                            </button>
                            {canEdit() && (
                              <>
                                <button
                                  type="button"
                                  className="icon-button"
                                  aria-label={`Edit ${e.farmerName}`}
                                  title="Edit"
                                  onClick={() => setEditId(editId === e.id ? null : e.id)}
                                >
                                  <EditIcon />
                                </button>
                                <button
                                  type="button"
                                  className="icon-button danger"
                                  aria-label={`Delete ${e.farmerName}`}
                                  title="Delete"
                                  onClick={() => {
                                    setConfirmId(e.id)
                                    setDeleteFailure('')
                                  }}
                                >
                                  <TrashIcon />
                                </button>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                      {editId === e.id && (
                        <tr className="detail-row">
                          <td colSpan={13}>
                            <EntryEditor
                              entry={e}
                              fields={forms.farmer}
                              onCancel={() => setEditId(null)}
                              onSaved={() => {
                                setEditId(null)
                                toast('Entry corrected')
                                reload()
                              }}
                            />
                          </td>
                        </tr>
                      )}
                      {openId === e.id && (
                        <tr className="detail-row">
                          <td colSpan={13}>
                            {e.updatedAt && (
                              <p className="muted gap-below">
                                Corrected in the office by {e.updatedBy || 'staff'} on{' '}
                                {formatDateTime(e.updatedAt)}.
                              </p>
                            )}
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

            {pages > 1 && (
              <nav className="card-foot pager" aria-label="Pages of entries">
                <button
                  type="button"
                  className="secondary"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  Previous
                </button>
                <p>
                  Page {number(page)} of {number(pages)}
                </p>
                <button
                  type="button"
                  className="secondary"
                  disabled={page >= pages}
                  onClick={() => goToPage(page + 1)}
                >
                  Next
                </button>
              </nav>
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
