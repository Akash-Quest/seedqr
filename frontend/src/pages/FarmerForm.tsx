import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import AnswerInput from '../components/AnswerInput'
import Field from '../components/Field'
import { Logo } from '../components/Icons'
import SeedDetails from '../components/SeedDetails'
import { APP_NAME, DEPARTMENT } from '../config'
import { CHANNELS } from '../data/channels'
import { getDeviceId, getDeviceInfo, newId } from '../data/device'
import { DEFAULT_FORMS, checkCustom } from '../data/forms'
import type { FieldSpec } from '../data/forms'
import {
  loadLot,
  postEntry,
  queueEntry,
  sendPending,
  usePendingCount,
} from '../data/outbox'
import type { FarmerEntry, KycType, PublicLot, SeedLot } from '../data/types'

type Loaded = PublicLot | 'loading' | 'missing' | 'offline'

function FarmerForm() {
  const { lotId = '' } = useParams()
  const [lot, setLot] = useState<Loaded>('loading')
  // 'queued' means it is on the phone and may or may not have been sent yet.
  const [saved, setSaved] = useState<null | 'sent' | 'queued'>(null)
  const pending = usePendingCount()

  useEffect(() => {
    let live = true
    loadLot(lotId).then((result) => live && setLot(result))
    void getDeviceInfo() // start early so it is ready at submit
    return () => {
      live = false
    }
  }, [lotId])

  return (
    <>
      <header className="topbar">
        <Logo light />
        <strong>{APP_NAME}</strong>
        <span>{DEPARTMENT}</span>
      </header>

      <main className="public-main">
        {lot === 'loading' && <p className="muted">Loading…</p>}

        {lot === 'missing' && (
          <div className="public-title">
            <h1>This code is not recognised</h1>
            <p>
              Scan the QR code on the seed bag again. If it still does not
              work, tell the person who gave you the bag.
            </p>
          </div>
        )}

        {lot === 'offline' && (
          <>
            <div className="public-title">
              <h1>No internet connection</h1>
              <p>
                The seed details could not be loaded. Move to a place with
                signal and try again.
              </p>
            </div>
            <button type="button" onClick={() => window.location.reload()}>
              Try again
            </button>
          </>
        )}

        {typeof lot === 'object' &&
          (saved ? (
            <Confirmation
              sent={saved === 'sent' || pending === 0}
              onAnother={() => setSaved(null)}
            />
          ) : (
            <>
              {pending > 0 && <Waiting count={pending} />}

              <div className="public-title">
                <h1>
                  {lot.crop}, {lot.variety}
                </h1>
                <p>Check the seed details, then fill in yours below.</p>
              </div>

              <section className="card">
                <div className="card-head">
                  <h2>Seed details</h2>
                  <p>From the code on this bag</p>
                </div>
                <div className="card-body">
                  <SeedDetails lot={lot} fields={lot.lotFields ?? DEFAULT_FORMS.lot} />
                </div>
              </section>

              <EntryForm
                lot={lot}
                fields={lot.farmerFields ?? DEFAULT_FORMS.farmer}
                onSaved={setSaved}
              />
            </>
          ))}
      </main>
    </>
  )
}

function Waiting({ count }: { count: number }) {
  return (
    <div className="warning">
      <p>
        {count === 1
          ? 'One earlier entry is saved on this phone and has not been sent yet.'
          : `${count} earlier entries are saved on this phone and have not been sent yet.`}
      </p>
      <button type="button" className="secondary" onClick={() => void sendPending()}>
        Send now
      </button>
    </div>
  )
}

function Confirmation({ sent, onAnother }: { sent: boolean; onAnother: () => void }) {
  return (
    <>
      {sent ? (
        <div className="notice" role="status">
          <h1>Sent</h1>
          <p>Your details have been received. Thank you.</p>
        </div>
      ) : (
        <div className="warning" role="status">
          <h1>Saved on this phone</h1>
          <p>
            There is no internet right now, so your details have not been sent
            yet. They will be sent by themselves when the signal comes back.
          </p>
          <p>
            <strong>Keep this page open until it says “Sent”.</strong>
          </p>
          <button type="button" className="secondary" onClick={() => void sendPending()}>
            Try sending now
          </button>
        </div>
      )}
      <button type="button" className="secondary" onClick={onAnother}>
        Fill in the form for another farmer
      </button>
    </>
  )
}

const blank = {
  filledBy: 'Farmer' as FarmerEntry['filledBy'],
  farmerName: '',
  kycType: '' as KycType,
  kycOther: '',
  idNumber: '',
  contact: '',
  channel: '',
  landholding: '',
  quantity: '',
  extra: {} as Record<string, string>,
}

type Values = typeof blank

// Only called when the form is submitted, never while drawing it.
function nowIso(): string {
  return new Date().toISOString()
}
type Errors = Record<string, string>

// Checks the questions that are shown, using the office's settings.
function check(values: Values, fields: FieldSpec[]): Errors {
  const errors: Errors = {}
  const idNumber = values.idNumber.replace(/\s/g, '')
  for (const field of fields) {
    const key = field.key
    if (!field.builtin) {
      const problem = checkCustom(field, values.extra[key] ?? '')
      if (problem) errors[key] = problem
      continue
    }
    switch (key) {
      case 'farmerName':
        if (values.farmerName.trim().length < 2) errors[key] = 'Enter the farmer’s name'
        break
      case 'kycType':
        if (field.required && !values.kycType) errors[key] = 'Choose a document type'
        break
      case 'idNumber':
        if (field.required && !idNumber) errors[key] = `Enter ${field.label.toLowerCase()}`
        else if (values.kycType === 'Aadhaar ID' && idNumber && !/^\d{12}$/.test(idNumber))
          errors[key] = 'An Aadhaar number has 12 digits'
        else if (values.kycType === 'PAN ID' && idNumber && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(idNumber))
          errors[key] = 'A PAN has 5 letters, 4 digits, then 1 letter'
        break
      case 'contact':
        if (field.required && !values.contact.trim()) errors[key] = 'Enter a mobile number'
        else if (values.contact.trim() && !/^\d{10}$/.test(values.contact.trim()))
          errors[key] = 'Enter a 10 digit mobile number, without spaces'
        break
      case 'channel':
        if (field.required && !values.channel) errors[key] = 'Choose a distribution channel'
        break
      default: {
        const value = values[key as keyof Values]
        if (field.required && typeof value === 'string' && !value.trim())
          errors[key] = `Enter ${field.label.toLowerCase()}`
      }
    }
  }
  return errors
}

type EntryFormProps = {
  lot: SeedLot
  // The questions, as the office set them up.
  fields: FieldSpec[]
  onSaved: (how: 'sent' | 'queued') => void
}

function EntryForm({ lot, fields, onSaved }: EntryFormProps) {
  const shown = fields.filter((field) => !field.hidden)
  const [values, setValues] = useState(blank)
  const [errors, setErrors] = useState<Errors>({})
  const [channelFilter, setChannelFilter] = useState('')
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (patch: Partial<Values>) => setValues({ ...values, ...patch })

  // The office's list, or the original one on a phone that saved this lot
  // before the list could be changed.
  const channelField = fields.find((field) => field.key === 'channel')
  const allChannels = channelField?.options.length ? channelField.options : CHANNELS
  const needle = channelFilter.trim().toLowerCase()
  const channels = allChannels.filter(
    (c) => c === values.channel || c.toLowerCase().includes(needle),
  )

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found = check(values, shown)
    setErrors(found)
    const firstBad = shown.find((field) => found[field.key])
    if (firstBad) {
      document.getElementById(firstBad.key)?.focus()
      return
    }

    setBusy(true)
    setFailure('')
    const extra: Record<string, string> = {}
    for (const field of shown) {
      if (!field.builtin) extra[field.key] = (values.extra[field.key] ?? '').trim()
    }
    const entry: FarmerEntry = {
      ...values,
      farmerName: values.farmerName.trim(),
      kycOther: values.kycType === 'Other' ? values.kycOther.trim() : '',
      idNumber: values.idNumber.replace(/\s/g, '').toUpperCase(),
      contact: values.contact.trim(),
      landholding: values.landholding.trim(),
      quantity: values.quantity.trim(),
      extra,
      id: newId(),
      lotId: lot.id,
      filledAt: nowIso(),
      deviceId: getDeviceId(),
      ...(await getDeviceInfo()),
      userAgent: navigator.userAgent,
    }

    try {
      // Save on the phone first, then try to send.
      await queueEntry(entry)
      await sendPending()
      onSaved('queued')
    } catch {
      // This phone cannot store data (for example private browsing),
      // so the only option is to send straight away.
      if (await postEntry(entry)) {
        onSaved('sent')
      } else {
        setFailure(
          'Your details could not be sent or saved. Check your internet and press Submit again.',
        )
        setBusy(false)
      }
    }
  }

  // The label row used by the two questions answered with round choices.
  function groupLabel(field: FieldSpec) {
    return (
      <>
        <div className="field-label">
          <label id={`${field.key}Label`}>{field.label}</label>
          <span>{field.required ? 'Required' : 'Optional'}</span>
        </div>
        {field.hint && <p className="hint">{field.hint}</p>}
        {errors[field.key] && <p className="error">{errors[field.key]}</p>}
      </>
    )
  }

  function question(field: FieldSpec) {
    const common = {
      key: field.key,
      id: field.key,
      label: field.label,
      optional: !field.required,
      hint: field.hint,
      error: errors[field.key],
    }
    switch (field.builtin ? field.key : '') {
      case 'filledBy':
        return (
          <div key={field.key} className="full" role="group" aria-labelledby="filledByLabel">
            {groupLabel(field)}
            <div className="chips">
              {(['Farmer', 'Field officer'] as const).map((who, i) => (
                <label key={who}>
                  <input
                    id={i === 0 ? field.key : undefined}
                    type="radio"
                    name="filledBy"
                    checked={values.filledBy === who}
                    onChange={() => set({ filledBy: who })}
                  />
                  {who}
                </label>
              ))}
            </div>
          </div>
        )
      case 'farmerName':
        return (
          <Field {...common} className="full">
            <input
              id={field.key}
              value={values.farmerName}
              onChange={(e) => set({ farmerName: e.target.value })}
              autoComplete="name"
            />
          </Field>
        )
      case 'kycType':
        return (
          <div key={field.key} className="full" role="group" aria-labelledby="kycTypeLabel">
            {groupLabel(field)}
            <div className="chips">
              {(['Aadhaar ID', 'PAN ID', 'Other'] as const).map((type, i) => (
                <label key={type}>
                  <input
                    id={i === 0 ? field.key : undefined}
                    type="radio"
                    name="kycType"
                    checked={values.kycType === type}
                    onChange={() => set({ kycType: type })}
                  />
                  {type}
                </label>
              ))}
            </div>
            {values.kycType === 'Other' && (
              <input
                className="gap"
                aria-label="Which document?"
                placeholder="Which document?"
                value={values.kycOther}
                onChange={(e) => set({ kycOther: e.target.value })}
              />
            )}
          </div>
        )
      case 'idNumber':
        return (
          <Field {...common}>
            <input
              id={field.key}
              className="mono"
              value={values.idNumber}
              onChange={(e) => set({ idNumber: e.target.value })}
              autoComplete="off"
            />
          </Field>
        )
      case 'contact':
        return (
          <Field {...common}>
            <input
              id={field.key}
              type="tel"
              inputMode="numeric"
              value={values.contact}
              onChange={(e) => set({ contact: e.target.value })}
              autoComplete="tel-national"
            />
          </Field>
        )
      case 'channel':
        return (
          <Field {...common} className="full">
            <input
              aria-label="Shorten the distribution channel list"
              placeholder="Type to shorten the list"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
            />
            <select
              id={field.key}
              value={values.channel}
              onChange={(e) => set({ channel: e.target.value })}
            >
              <option value="">
                {channels.length === 0 ? 'Nothing matches' : `Choose (${channels.length})`}
              </option>
              {channels.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        )
      case 'landholding':
      case 'quantity': {
        const key = field.key as 'landholding' | 'quantity'
        return (
          <Field {...common}>
            <input
              id={key}
              value={values[key]}
              onChange={(e) => set({ [key]: e.target.value })}
            />
          </Field>
        )
      }
      default:
        // A question the office added.
        return (
          <Field {...common} className={field.type === 'textarea' ? 'full' : ''}>
            <AnswerInput
              field={field}
              value={values.extra[field.key] ?? ''}
              onChange={(value) => set({ extra: { ...values.extra, [field.key]: value } })}
            />
          </Field>
        )
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head">
        <h2>Farmer details</h2>
      </div>

      <div className="card-body form-grid">{shown.map(question)}</div>

      <div className="card-foot">
        {failure ? (
          <p className="grow error" role="alert">
            {failure}
          </p>
        ) : (
          <p className="grow">
            {DEPARTMENT} records these details together with information
            about this phone: its model, browser, screen and network address.
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Submit'}
        </button>
      </div>
    </form>
  )
}

export default FarmerForm
