import { useState } from 'react'
import { api } from '../data/api'
import { CUSTOM_TYPES, newFieldKey } from '../data/forms'
import type { FieldSpec } from '../data/forms'
import ChannelEditor from './ChannelEditor'
import { PlusIcon, TrashIcon } from './Icons'

type FormEditorProps = {
  form: 'lot' | 'farmer'
  title: string
  description: string
  fields: FieldSpec[]
  onSaved: (fields: FieldSpec[]) => void
}

const BUILTIN_KIND: Record<string, string> = {
  choice: 'Farmer or field officer',
  kyc: 'Aadhaar, PAN or other',
  phone: 'Mobile number',
  channel: 'List of channels',
  date: 'Date',
  text: 'Short answer',
}

// Lets the office rename, reorder, hide and add questions on one form.
function FormEditor({ form, title, description, fields, onSaved }: FormEditorProps) {
  const [list, setList] = useState(fields)
  const [status, setStatus] = useState<{ error?: string; saved?: boolean }>({})
  const [busy, setBusy] = useState(false)
  const [channelsOpen, setChannelsOpen] = useState(false)
  const changed = JSON.stringify(list) !== JSON.stringify(fields)

  function update(index: number, patch: Partial<FieldSpec>) {
    setList(list.map((field, i) => (i === index ? { ...field, ...patch } : field)))
    setStatus({})
  }

  function move(index: number, by: number) {
    const next = [...list]
    const [field] = next.splice(index, 1)
    next.splice(index + by, 0, field)
    setList(next)
    setStatus({})
  }

  function remove(index: number) {
    setList(list.filter((_, i) => i !== index))
    setStatus({})
  }

  function add() {
    setList([
      ...list,
      {
        key: newFieldKey(), label: '', hint: '', type: 'text', options: [],
        required: false, hidden: false, builtin: false, core: false,
      },
    ])
    setStatus({})
  }

  async function save() {
    const unnamed = list.find((field) => !field.builtin && field.label.trim() === '')
    if (unnamed) {
      setStatus({ error: 'Give every new question a name.' })
      return
    }
    const noChoices = list.find(
      (field) => field.type === 'select' && field.options.every((o) => o.trim() === ''),
    )
    if (noChoices) {
      setStatus({ error: `“${noChoices.label}” needs at least one choice.` })
      return
    }
    setBusy(true)
    try {
      const saved = await api<FieldSpec[]>(`/forms/${form}`, list, 'PUT')
      setList(saved)
      onSaved(saved)
      setStatus({ saved: true })
    } catch (err) {
      setStatus({ error: (err as Error).message })
    }
    setBusy(false)
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <ol className="field-list">
        {list.map((field, index) => (
          <li key={field.key} className={field.hidden ? 'is-hidden' : ''}>
            <div className="field-order">
              <button
                type="button"
                className="icon-button"
                aria-label={`Move “${field.label || 'new question'}” up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Move “${field.label || 'new question'}” down`}
                disabled={index === list.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </div>

            <div className="field-main">
              <input
                aria-label="Question"
                placeholder="Question, for example “Village”"
                value={field.label}
                onChange={(e) => update(index, { label: e.target.value })}
              />
              <input
                className="field-hint"
                aria-label="Help text"
                placeholder="Help text shown under the question (optional)"
                value={field.hint}
                onChange={(e) => update(index, { hint: e.target.value })}
              />
              {field.type === 'channel' && (
                <>
                  <button
                    type="button"
                    className="link-button"
                    aria-expanded={channelsOpen}
                    onClick={() => setChannelsOpen(!channelsOpen)}
                  >
                    {channelsOpen
                      ? 'Close the channel list'
                      : `Add or change channels (${field.options.length})`}
                  </button>
                  {channelsOpen && (
                    <ChannelEditor
                      channels={field.options}
                      onChange={(options) => update(index, { options })}
                    />
                  )}
                </>
              )}
              {field.type === 'select' && !field.builtin && (
                <textarea
                  aria-label="Choices"
                  placeholder="One choice per line"
                  rows={3}
                  value={field.options.join('\n')}
                  onChange={(e) => update(index, { options: e.target.value.split('\n') })}
                />
              )}
            </div>

            <div className="field-type">
              {field.builtin ? (
                <span className="muted">
                  {BUILTIN_KIND[field.type] ?? 'Short answer'}
                  <small>{field.core ? 'Built in, always asked' : 'Built in'}</small>
                </span>
              ) : (
                <select
                  aria-label="Type of answer"
                  value={field.type}
                  onChange={(e) =>
                    update(index, { type: e.target.value as FieldSpec['type'] })
                  }
                >
                  {CUSTOM_TYPES.map(([type, name]) => (
                    <option key={type} value={type}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="field-switches">
              <label className="check">
                <input
                  type="checkbox"
                  checked={field.required}
                  disabled={field.core || field.hidden}
                  onChange={(e) => update(index, { required: e.target.checked })}
                />
                Required
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!field.hidden}
                  disabled={field.core}
                  onChange={(e) => update(index, { hidden: !e.target.checked })}
                />
                Shown
              </label>
            </div>

            <div className="field-remove">
              {!field.builtin && (
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`Remove “${field.label || 'new question'}”`}
                  title="Remove"
                  onClick={() => remove(index)}
                >
                  <TrashIcon />
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="card-foot">
        <button type="button" className="secondary" onClick={add}>
          <PlusIcon />
          Add a question
        </button>
        <p className="grow" role="status">
          {status.error ? (
            <span className="error">{status.error}</span>
          ) : status.saved && !changed ? (
            'Saved. The form shows these questions from now on.'
          ) : changed ? (
            'You have changes that are not saved yet.'
          ) : (
            ''
          )}
        </p>
        {changed && (
          <button type="button" className="secondary" onClick={() => setList(fields)}>
            Undo changes
          </button>
        )}
        <button type="button" disabled={!changed || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save form'}
        </button>
      </div>
    </section>
  )
}

export default FormEditor
