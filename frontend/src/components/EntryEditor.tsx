import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../data/api'
import { CloseIcon } from './Icons'
import { checkCustom } from '../data/forms'
import type { FieldSpec } from '../data/forms'
import type { KycType, ReceivedEntry } from '../data/types'
import AnswerInput from './AnswerInput'
import Field from './Field'

type EntryEditorProps = {
  entry: ReceivedEntry
  // The farmer form's questions, as the office set them up.
  fields: FieldSpec[]
  onSaved: () => void
  onCancel: () => void
}

const KYC_TYPES: KycType[] = ['', 'Aadhaar ID', 'PAN ID', 'Other']

// Corrects what was written on one entry, in a window over the page.
// Which seed lot it belongs to, when it was received and what phone sent it
// are not changed here.
function EntryEditor({ entry, fields, onSaved, onCancel }: EntryEditorProps) {
  const [values, setValues] = useState({
    date: entry.date ?? '',
    filledBy: entry.filledBy,
    farmerName: entry.farmerName,
    kycType: entry.kycType,
    kycOther: entry.kycOther,
    idNumber: entry.idNumber,
    contact: entry.contact,
    channel: entry.channel,
    landholding: entry.landholding,
    quantity: entry.quantity,
    extra: { ...entry.extra },
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)

  // Opens over the page, with the rest of it dimmed and out of reach.
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const box = dialog.current
    if (box && !box.open) box.showModal()
    return () => box?.close()
  }, [])

  const set = (patch: Partial<typeof values>) => setValues({ ...values, ...patch })
  const label = (key: string, fallback: string) =>
    fields.find((field) => field.key === key)?.label ?? fallback
  // Ids start with "edit" so they never clash with another form on the page.
  const id = (key: string) => `edit-${key}`
  const custom = fields.filter((field) => !field.builtin && !field.hidden)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found: Record<string, string> = {}
    if (values.farmerName.trim().length < 2) found.farmerName = 'Enter the farmer’s name'
    for (const field of custom) {
      // Only the format is checked: an old entry may lack an answer to a
      // question that was added, or made required, after it came in.
      const value = values.extra[field.key] ?? ''
      const problem = value.trim() ? checkCustom(field, value) : ''
      if (problem) found[field.key] = problem
    }
    setErrors(found)
    const firstBad = Object.keys(found)[0]
    if (firstBad) {
      document.getElementById(id(firstBad))?.focus()
      return
    }

    setBusy(true)
    setFailure('')
    try {
      await api(
        `/entries/${encodeURIComponent(entry.id)}`,
        {
          ...values,
          farmerName: values.farmerName.trim(),
          kycOther: values.kycType === 'Other' ? values.kycOther.trim() : '',
          idNumber: values.idNumber.replace(/\s/g, '').toUpperCase(),
          contact: values.contact.trim(),
          // Only the questions shown here: the rest keep their answers.
          extra: Object.fromEntries(
            custom.map((field) => [field.key, (values.extra[field.key] ?? '').trim()]),
          ),
        },
        'PUT',
      )
      onSaved()
    } catch (err) {
      setFailure((err as Error).message)
      setBusy(false)
    }
  }

  // A plain one-line answer.
  function line(key: 'farmerName' | 'idNumber' | 'contact' | 'channel' | 'landholding' | 'quantity', fallback: string, className = '') {
    return (
      <Field id={id(key)} label={label(key, fallback)} error={errors[key]} className={className}>
        <input
          id={id(key)}
          className={key === 'idNumber' || key === 'contact' ? 'mono' : undefined}
          value={values[key]}
          onChange={(e) => set({ [key]: e.target.value })}
          autoComplete="off"
        />
      </Field>
    )
  }

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="edit-title"
      // Escape closes it, the same as Cancel.
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <form className="modal-form" onSubmit={submit} noValidate>
        <div className="modal-head">
          <div>
            <h2 id="edit-title">Edit farmer entry</h2>
            <p className="muted">
              {entry.farmerName || 'No name'} · {entry.lot?.crop}, {entry.lot?.variety}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel}>
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body form-grid">
          {line('farmerName', 'Farmer name')}
          <Field id={id('date')} label={label('date', 'Date')}>
            <input
              id={id('date')}
              type="date"
              value={values.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </Field>
          <Field id={id('kycType')} label={label('kycType', 'Document / KYC type')}>
            <select
              id={id('kycType')}
              value={values.kycType}
              onChange={(e) => set({ kycType: e.target.value as KycType })}
            >
              {KYC_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type || 'Not given'}
                </option>
              ))}
            </select>
          </Field>
          {values.kycType === 'Other' && (
            <Field id={id('kycOther')} label="Which document?">
              <input
                id={id('kycOther')}
                value={values.kycOther}
                onChange={(e) => set({ kycOther: e.target.value })}
              />
            </Field>
          )}
          {line('idNumber', 'ID number')}
          {line('contact', 'Contact number')}
          {line('landholding', 'Landholding size')}
          {line('quantity', 'Quantity of seed given')}
          <Field id={id('filledBy')} label={label('filledBy', 'Who filled this in?')}>
            <select
              id={id('filledBy')}
              value={values.filledBy}
              onChange={(e) => set({ filledBy: e.target.value as ReceivedEntry['filledBy'] })}
            >
              <option>Farmer</option>
              <option>Field officer</option>
            </select>
          </Field>
          {line('channel', 'Distribution channel', 'full')}
          {custom.map((field) => (
            <Field
              key={field.key}
              id={id(field.key)}
              label={field.label}
              error={errors[field.key]}
              className={field.type === 'textarea' ? 'full' : ''}
            >
              <AnswerInput
                field={{ ...field, key: id(field.key) }}
                value={values.extra[field.key] ?? ''}
                onChange={(value) => set({ extra: { ...values.extra, [field.key]: value } })}
              />
            </Field>
          ))}
        </div>

        <div className="modal-foot">
          {failure && (
            <p className="error" role="alert">
              {failure}
            </p>
          )}
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export default EntryEditor
