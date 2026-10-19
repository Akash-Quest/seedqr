import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import AnswerInput from '../components/AnswerInput'
import Field from '../components/Field'
import FormEditor from '../components/FormEditor'
import {
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  PrintIcon,
  SearchIcon,
  TrashIcon,
} from '../components/Icons'
import PageHeader from '../components/PageHeader'
import { PageSkeleton } from '../components/Skeleton'
import { DEPARTMENT, PUBLIC_URL } from '../config'
import { api, canEdit, isAdmin, useApi } from '../data/api'
import { toast } from '../data/toast'
import { DEFAULT_FORMS, answer, checkCustom } from '../data/forms'
import type { FieldSpec, Forms } from '../data/forms'
import { formatDate } from '../data/types'
import type { NewSeedLot, SeedLot } from '../data/types'

function blankLot(): NewSeedLot {
  return {
    date: new Date().toLocaleDateString('en-CA'), // YYYY-MM-DD, local time
    seedType: '',
    crop: '',
    variety: '',
    batchNo: '',
    productionSource: '',
    certification: '',
    expiryDate: '',
    storageLocation: '',
    packingLocation: '',
    extra: {},
  }
}

function Barcode() {
  const { data: lots, error, reload } = useApi<SeedLot[]>('/lots')
  const forms = useApi<Forms>('/forms')
  const [params, setParams] = useSearchParams()
  const lotFields = forms.data?.lot ?? DEFAULT_FORMS.lot

  // What this account's role allows. The server checks again.
  const mayEdit = canEdit()
  const mayEditForms = isAdmin()

  const selected = lots?.find((lot) => lot.id === params.get('lot'))
  const editing = mayEdit ? lots?.find((lot) => lot.id === params.get('edit')) : undefined
  const editingForms = mayEditForms && params.has('fields')
  // With no lots yet there is nothing to list, so start on the form.
  const adding = mayEdit && (params.has('new') || (lots?.length === 0 && !editingForms))

  return (
    <>
      <PageHeader
        title="Barcode"
        subtitle="Add a seed lot and print the QR code for its bags."
      />

      <div className="page">
        {error ? (
          <p className="problem">{error}</p>
        ) : !lots ? (
          <PageSkeleton />
        ) : (
          <>
            <div className="tabs no-print">
              <button
                type="button"
                className={adding || editingForms ? '' : 'on'}
                aria-pressed={!adding && !editingForms}
                disabled={lots.length === 0}
                onClick={() => setParams({})}
              >
                Seed lots
                <span className="badge">{lots.length}</span>
              </button>
              {mayEdit && (
                <button
                  type="button"
                  className={adding ? 'on' : ''}
                  aria-pressed={adding}
                  onClick={() => setParams({ new: '1' })}
                >
                  New seed lot
                </button>
              )}
              {mayEditForms && (
                <button
                  type="button"
                  className={editingForms ? 'on' : ''}
                  aria-pressed={editingForms}
                  onClick={() => setParams({ fields: '1' })}
                >
                  Form fields
                </button>
              )}
            </div>

            {editingForms ? (
              forms.error ? (
                <p className="problem">{forms.error}</p>
              ) : !forms.data ? (
                <p className="muted">Loading…</p>
              ) : (
                <>
                  <FormEditor
                    form="lot"
                    title="Seed details form"
                    description="What the office fills in for each seed lot. Farmers see these answers after scanning."
                    fields={forms.data.lot}
                    onSaved={forms.reload}
                  />
                  <FormEditor
                    form="farmer"
                    title="Farmer form"
                    description="What the farmer fills in on their phone after scanning a bag."
                    fields={forms.data.farmer}
                    onSaved={forms.reload}
                  />
                </>
              )
            ) : adding ? (
              <LotForm
                fields={lotFields}
                onSaved={(lot) => {
                  // The same crop, variety and batch as a lot already here
                  // gives that lot back, with the QR code it always had.
                  setParams(lot.existing ? { lot: lot.id, existing: '1' } : { lot: lot.id })
                  toast(
                    lot.existing
                      ? 'That seed lot was already here, so this is its QR code'
                      : 'Seed lot saved. Its QR code is ready.',
                    lot.existing ? 'info' : 'ok',
                  )
                  reload()
                }}
              />
            ) : editing ? (
              <LotForm
                key={editing.id}
                fields={lotFields}
                lot={editing}
                onCancel={() => setParams({ lot: editing.id })}
                onSaved={(lot) => {
                  setParams({ lot: lot.id })
                  toast('Seed details saved. Labels already printed show the new details.')
                  reload()
                }}
              />
            ) : (
              <>
                {selected && (
                  <QrLabel
                    key={selected.id}
                    lot={selected}
                    existing={params.has('existing')}
                    mayEdit={mayEdit}
                    onEdit={() => setParams({ edit: selected.id })}
                    onDeleted={() => {
                      setParams({})
                      toast('Seed lot deleted. Its QR code no longer opens the form.')
                      reload()
                    }}
                    onClose={() => setParams({})}
                  />
                )}
                {lots.length === 0 && (
                  <p className="empty">
                    <strong>No seed lots yet</strong>
                    They appear here once someone in the office adds one.
                  </p>
                )}
                <LotTable
                  lots={lots}
                  selectedId={selected?.id}
                  mayEdit={mayEdit}
                  onShow={(id) => {
                    setParams({ lot: id })
                    window.scrollTo(0, 0)
                  }}
                  onEdit={(id) => {
                    setParams({ edit: id })
                    window.scrollTo(0, 0)
                  }}
                  onDeleted={() => {
                    setParams({})
                    toast('Seed lot deleted. Its QR code no longer opens the form.')
                    reload()
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}

type LotFormProps = {
  // The questions, as the office set them up.
  fields: FieldSpec[]
  // Given when changing an existing lot. Left out when adding a new one.
  lot?: SeedLot
  onCancel?: () => void
  onSaved: (lot: SeedLot) => void
}

function LotForm({ fields, lot, onCancel, onSaved }: LotFormProps) {
  const shown = fields.filter((field) => !field.hidden)
  const [values, setValues] = useState<NewSeedLot>(() => {
    if (!lot) return blankLot()
    const start = blankLot()
    for (const key of Object.keys(start) as (keyof NewSeedLot)[]) {
      if (key !== 'extra') start[key] = lot[key]
    }
    start.extra = { ...lot.extra }
    return start
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)

  function setAnswer(field: FieldSpec, value: string) {
    setValues(
      field.builtin
        ? { ...values, [field.key]: value }
        : { ...values, extra: { ...values.extra, [field.key]: value } },
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found: Record<string, string> = {}
    for (const field of shown) {
      const value = answer(values, field)
      if (!field.builtin) {
        const problem = checkCustom(field, value)
        if (problem) found[field.key] = problem
      } else if (field.required && value.trim() === '') {
        found[field.key] = `Enter ${field.label.toLowerCase()}`
      }
    }
    setErrors(found)
    const firstBad = shown.find((field) => found[field.key])
    if (firstBad) {
      document.getElementById(firstBad.key)?.focus()
      return
    }

    setBusy(true)
    setFailure('')
    try {
      onSaved(
        lot
          ? await api<SeedLot>(`/lots/${lot.id}`, values, 'PUT')
          : await api<SeedLot>('/lots', values),
      )
    } catch (err) {
      setFailure((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head">
        <h2>{lot ? 'Change seed details' : 'Seed details'}</h2>
        <p>A farmer who scans the code sees exactly this.</p>
      </div>

      <div className="card-body form-grid">
        {shown.map((field) => (
          <Field
            key={field.key}
            id={field.key}
            className={field.type === 'textarea' ? 'full' : ''}
            label={field.label}
            optional={!field.required}
            hint={field.hint}
            error={errors[field.key]}
          >
            <AnswerInput
              field={field}
              value={answer(values, field)}
              onChange={(value) => setAnswer(field, value)}
            />
          </Field>
        ))}
      </div>

      <div className="card-foot">
        {failure ? (
          <p className="grow error" role="alert">
            {failure}
          </p>
        ) : (
          <p className="grow">
            {lot
              ? 'The QR code stays the same, so bags already labelled will show the new details. Entries farmers already sent keep the details they saw.'
              : 'You can change these details later without printing a new code.'}
          </p>
        )}
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : lot ? 'Save changes' : 'Save and make QR code'}
        </button>
      </div>
    </form>
  )
}

type LotTableProps = {
  lots: SeedLot[]
  selectedId?: string
  // False for an account that may only look.
  mayEdit: boolean
  onShow: (id: string) => void
  onEdit: (id: string) => void
  onDeleted: () => void
}

type Order = 'new' | 'most' | 'crop'

function LotTable({ lots, selectedId, mayEdit, onShow, onEdit, onDeleted }: LotTableProps) {
  // The row whose delete button was pressed and is waiting for a yes or no.
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [failure, setFailure] = useState('')
  const [filter, setFilter] = useState('')
  const [order, setOrder] = useState<Order>('new')

  const needle = filter.trim().toLowerCase()
  const most = Math.max(1, ...lots.map((lot) => lot.entryCount ?? 0))
  const shown = lots.filter(
    (lot) =>
      !needle ||
      [lot.crop, lot.variety, lot.batchNo, lot.id].some((value) => value.toLowerCase().includes(needle)),
  )
  // The server sends the newest first; the other orders are made here.
  if (order === 'most') shown.sort((a, b) => (b.entryCount ?? 0) - (a.entryCount ?? 0))
  if (order === 'crop')
    shown.sort((a, b) => a.crop.localeCompare(b.crop) || a.variety.localeCompare(b.variety))

  async function remove(id: string) {
    try {
      await api(`/lots/${id}`, undefined, 'DELETE')
      setConfirmId(null)
      onDeleted()
    } catch (err) {
      setFailure((err as Error).message)
    }
  }

  return (
    <section className="card no-print">
      <div className="card-head">
        <h2>Seed lots</h2>
        <div className="card-head-end">
          <label className="mini-search">
            <SearchIcon />
            <input
              type="search"
              aria-label="Find a seed lot by crop, variety, batch or code"
              placeholder="Find a lot"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <select
            className="step-select"
            aria-label="Order of the list"
            value={order}
            onChange={(e) => setOrder(e.target.value as Order)}
          >
            <option value="new">Newest first</option>
            <option value="most">Most entries</option>
            <option value="crop">Crop A to Z</option>
          </select>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="number">No.</th>
              <th>Crop</th>
              <th>Variety</th>
              <th>Batch/lot</th>
              <th>Date</th>
              <th>Farmer entries</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No seed lot matches “{filter.trim()}”.
                </td>
              </tr>
            )}
            {shown.map((lot, index) => (
              <tr key={lot.id} className={lot.id === selectedId ? 'picked' : ''}>
                <td className="number">{index + 1}</td>
                <td className="strong">{lot.crop}</td>
                <td>{lot.variety}</td>
                <td className="mono">{lot.batchNo}</td>
                <td>{formatDate(lot.date)}</td>
                <td>
                  <span className="count-cell">
                    <span className="count-bar" aria-hidden="true">
                      <i style={{ width: `${((lot.entryCount ?? 0) / most) * 100}%` }} />
                    </span>
                    {(lot.entryCount ?? 0).toLocaleString('en-IN')}
                  </span>
                </td>
                {confirmId === lot.id ? (
                  <td className="row-actions">
                    <span>
                      {failure ||
                        (lot.entryCount
                          ? 'Delete? Its QR code stops working. Entries are kept.'
                          : 'Delete? Its QR code stops working.')}
                    </span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setConfirmId(null)
                        setFailure('')
                      }}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      className="link-button danger"
                      onClick={() => void remove(lot.id)}
                    >
                      Yes, delete
                    </button>
                  </td>
                ) : (
                  <td className="row-actions">
                    {lot.id === selectedId ? (
                      <span>Shown above</span>
                    ) : (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onShow(lot.id)}
                      >
                        Show QR code
                      </button>
                    )}
                    {mayEdit && (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Change details of ${lot.crop}, ${lot.variety}`}
                          title="Change details"
                          onClick={() => onEdit(lot.id)}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          aria-label={`Delete ${lot.crop}, ${lot.variety}`}
                          title="Delete"
                          onClick={() => {
                            setConfirmId(lot.id)
                            setFailure('')
                          }}
                        >
                          <TrashIcon />
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

type QrLabelProps = {
  lot: SeedLot
  // True when someone has just tried to add this lot again.
  existing: boolean
  // False for an account that may only look.
  mayEdit: boolean
  onEdit: () => void
  onDeleted: () => void
  onClose: () => void
}

function QrLabel({ lot, existing, mayEdit, onEdit, onDeleted, onClose }: QrLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  // Deleting asks for a second press, since printed labels stop working.
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState('')
  const address = useApi<{ lan: string | null }>('/address')

  // "localhost" means nothing to a phone, so swap in this computer's
  // network address when the admin page was opened that way.
  const isLocal = /\/\/(localhost|127\.0\.0\.1)(:|$)/.test(PUBLIC_URL)
  if (isLocal && !address.data && !address.error) {
    return <p className="muted">Loading…</p>
  }
  const lan = address.data?.lan
  const base =
    isLocal && lan
      ? PUBLIC_URL.replace(/localhost|127\.0\.0\.1/, lan)
      : PUBLIC_URL
  const link = `${base}/f/${lot.id}`
  const localOnly = isLocal && !lan

  async function remove() {
    try {
      await api(`/lots/${lot.id}`, undefined, 'DELETE')
      onDeleted()
    } catch (err) {
      setFailure((err as Error).message)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      toast('Link copied')
    } catch {
      toast(`This browser would not copy the link. It is ${link}`, 'error')
    }
  }

  function download() {
    if (!svgRef.current) return
    const svg = new XMLSerializer().serializeToString(svgRef.current)
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `qr-${lot.batchNo || lot.id}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="card">
      <div className="card-head no-print">
        <div>
          <h2>
            QR code for {lot.crop}, {lot.variety}
          </h2>
          <p>
            Batch/lot {lot.batchNo}
            {lot.updatedAt && ` · details changed ${formatDate(lot.updatedAt)}`}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="card-body">
        {existing && (
          <p className="notice no-print" role="status">
            <strong>This seed lot was already here.</strong> A lot with the same crop, variety
            and batch/lot number keeps one QR code, so nothing new was made. This is its code,
            with the details it already had. To change them, use “Change details”.
          </p>
        )}
        {localOnly && (
          <p className="warning no-print">
            This code points to <span className="mono">{base}</span>, which only
            works on this computer. Phones will not be able to open it. Connect
            this computer to a network, or open this page on the site’s real
            address, before printing.
          </p>
        )}

        <div className="label">
          <QRCodeSVG ref={svgRef} value={link} size={200} level="M" marginSize={2} />
          <div>
            <p className="label-dept">{DEPARTMENT}</p>
            <p className="label-name">
              {lot.crop}, {lot.variety}
              <span>Batch/lot {lot.batchNo}</span>
            </p>
            <p className="label-help">
              Scan with your phone camera and fill in your details.
            </p>
            <p className="label-code mono">{lot.id}</p>
          </div>
        </div>

      </div>

      {confirming ? (
        <div className="card-foot no-print">
          <p className="grow">
            <strong>Delete this seed lot?</strong> Its QR code will stop
            working on every bag it is printed on.{' '}
            {lot.entryCount
              ? `The ${lot.entryCount} farmer ${lot.entryCount === 1 ? 'entry' : 'entries'} already received will be kept.`
              : 'No farmer has used it yet.'}
            {failure && <span className="error"> {failure}</span>}
          </p>
          <button type="button" className="secondary" onClick={() => setConfirming(false)}>
            Keep it
          </button>
          <button type="button" className="danger" onClick={() => void remove()}>
            Yes, delete
          </button>
        </div>
      ) : (
        <div className="card-foot end no-print">
          {mayEdit && (
            <>
              <button type="button" className="secondary danger" onClick={() => setConfirming(true)}>
                Delete
              </button>
              <button type="button" className="secondary" onClick={onEdit}>
                Change details
              </button>
            </>
          )}
          <button type="button" className="secondary" onClick={() => void copyLink()}>
            <CopyIcon />
            Copy link
          </button>
          <button type="button" className="secondary" onClick={download}>
            <DownloadIcon />
            Download QR code
          </button>
          <button type="button" onClick={() => window.print()}>
            <PrintIcon />
            Print label
          </button>
        </div>
      )}
    </section>
  )
}

export default Barcode
