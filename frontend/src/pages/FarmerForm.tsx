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
import { CHOICES, TEXT, localize, saveLang, savedLang } from '../data/farmerText'
import type { Lang, Text } from '../data/farmerText'
import { DEFAULT_FORMS } from '../data/forms'
import type { FieldSpec } from '../data/forms'
import {
  loadLot,
  postEntry,
  queueEntry,
  sendPending,
  usePendingCount,
  wasRefused,
} from '../data/outbox'
import type { FarmerEntry, KycType, PublicLot, SeedLot } from '../data/types'

type Loaded = PublicLot | 'loading' | 'missing' | 'offline'

function FarmerForm() {
  const { lotId = '' } = useParams()
  const [lot, setLot] = useState<Loaded>('loading')
  // 'queued' means it is on the phone and may or may not have been sent yet.
  const [saved, setSaved] = useState<null | 'sent' | 'queued'>(null)
  const pending = usePendingCount()
  // Hindi first: the form is for farmers in Bihar.
  const [lang, setLang] = useState<Lang>(savedLang)
  const t = TEXT[lang]

  useEffect(() => {
    let live = true
    loadLot(lotId).then((result) => live && setLot(result))
    void getDeviceInfo() // start early so it is ready at submit
    return () => {
      live = false
    }
  }, [lotId])

  // Screen readers then read the page in the right language.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  function chooseLang(next: Lang) {
    setLang(next)
    saveLang(next)
  }

  return (
    <>
      <header className="topbar">
        <Logo light />
        <strong>{APP_NAME}</strong>
        <span>{DEPARTMENT}</span>
      </header>

      <main className="public-main">
        <div className="lang-switch" role="group" aria-label="भाषा / Language">
          <button
            type="button"
            className={lang === 'hi' ? 'on' : ''}
            aria-pressed={lang === 'hi'}
            lang="hi"
            onClick={() => chooseLang('hi')}
          >
            हिन्दी
          </button>
          <button
            type="button"
            className={lang === 'en' ? 'on' : ''}
            aria-pressed={lang === 'en'}
            lang="en"
            onClick={() => chooseLang('en')}
          >
            English
          </button>
        </div>

        {lot === 'loading' && <p className="muted">{t.loading}</p>}

        {lot === 'missing' && (
          <div className="public-title">
            <h1>{t.missingTitle}</h1>
            <p>{t.missingText}</p>
          </div>
        )}

        {lot === 'offline' && (
          <>
            <div className="public-title">
              <h1>{t.offlineTitle}</h1>
              <p>{t.offlineText}</p>
            </div>
            <button type="button" onClick={() => window.location.reload()}>
              {t.tryAgain}
            </button>
          </>
        )}

        {typeof lot === 'object' &&
          (saved ? (
            <Confirmation
              t={t}
              sent={saved === 'sent' || pending === 0}
              onAnother={() => setSaved(null)}
            />
          ) : (
            <>
              {pending > 0 && <Waiting t={t} count={pending} />}

              <div className="public-title">
                <h1>
                  {lot.crop}, {lot.variety}
                </h1>
                <p>{t.intro}</p>
              </div>

              <section className="card">
                <div className="card-head">
                  <h2>{t.seedDetails}</h2>
                  <p>{t.fromCode}</p>
                </div>
                <div className="card-body">
                  <SeedDetails
                    lot={lot}
                    fields={localize(lot.lotFields ?? DEFAULT_FORMS.lot, 'lot', lang)}
                  />
                </div>
              </section>

              <EntryForm
                lot={lot}
                fields={localize(lot.farmerFields ?? DEFAULT_FORMS.farmer, 'farmer', lang)}
                lang={lang}
                onSaved={setSaved}
              />
            </>
          ))}
      </main>
    </>
  )
}

function Waiting({ t, count }: { t: Text; count: number }) {
  return (
    <div className="warning">
      <p>{t.waiting(count)}</p>
      <button type="button" className="secondary" onClick={() => void sendPending()}>
        {t.sendNow}
      </button>
    </div>
  )
}

function Confirmation({ t, sent, onAnother }: { t: Text; sent: boolean; onAnother: () => void }) {
  return (
    <>
      {sent ? (
        <div className="notice sent" role="status">
          <svg className="tick" viewBox="0 0 52 52" aria-hidden="true">
            <circle cx="26" cy="26" r="23" />
            <path d="M15 27l7.5 7.5L37 19" />
          </svg>
          <div>
            <h1>{t.sent}</h1>
            <p>{t.sentText}</p>
          </div>
        </div>
      ) : (
        <div className="warning" role="status">
          <h1>{t.savedTitle}</h1>
          <p>{t.savedText}</p>
          <p>
            <strong>{t.keepOpen}</strong>
          </p>
          <button type="button" className="secondary" onClick={() => void sendPending()}>
            {t.trySending}
          </button>
        </div>
      )}
      <button type="button" className="secondary" onClick={onAnother}>
        {t.another}
      </button>
    </>
  )
}

const blank = {
  date: '',
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

// Checks the questions that are shown, using the office's settings. The
// messages are in the form's language (`fields` are already in it too).
function check(values: Values, fields: FieldSpec[], t: Text): Errors {
  const errors: Errors = {}
  const idNumber = values.idNumber.replace(/\s/g, '')
  for (const field of fields) {
    const key = field.key
    if (!field.builtin) {
      // A question the office added.
      const value = (values.extra[key] ?? '').trim()
      if (value === '' && field.required) errors[key] = t.enter(field.label)
      else if (value !== '' && field.type === 'number' && !Number.isFinite(Number(value)))
        errors[key] = t.enterNumber
      continue
    }
    switch (key) {
      case 'farmerName':
        if (values.farmerName.trim().length < 2) errors[key] = t.enterName
        break
      case 'kycType':
        if (field.required && !values.kycType) errors[key] = t.chooseDocument
        break
      case 'idNumber':
        if (field.required && !idNumber) errors[key] = t.enter(field.label)
        else if (values.kycType === 'PAN ID' && idNumber && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(idNumber))
          errors[key] = t.panShape
        break
      case 'contact':
        if (field.required && !values.contact.trim()) errors[key] = t.enterMobile
        else if (values.contact.trim() && !/^\d{10}$/.test(values.contact.trim()))
          errors[key] = t.mobileDigits
        break
      case 'channel':
        if (field.required && !values.channel) errors[key] = t.chooseChannel
        break
      default: {
        const value = values[key as keyof Values]
        if (field.required && typeof value === 'string' && !value.trim())
          errors[key] = t.enter(field.label)
      }
    }
  }
  return errors
}

type EntryFormProps = {
  lot: SeedLot
  // The questions, as the office set them up, in the form's language.
  fields: FieldSpec[]
  lang: Lang
  onSaved: (how: 'sent' | 'queued') => void
}

function EntryForm({ lot, fields, lang, onSaved }: EntryFormProps) {
  const t = TEXT[lang]
  // What a fixed choice is called in this language; saved in English.
  const choice = (value: string) => CHOICES[lang][value] ?? value
  const shown = fields.filter((field) => !field.hidden)
  const [values, setValues] = useState(blank)
  const [channelFilter, setChannelFilter] = useState('')
  const [failure, setFailure] = useState<'' | 'refused' | 'notSent'>('')
  const [busy, setBusy] = useState(false)

  // After the first Submit the answers are checked as they change, so a
  // message goes once its answer is put right, and follows the language.
  const [checked, setChecked] = useState(false)
  const shownErrors: Errors = checked ? check(values, shown, t) : {}

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
    const found = check(values, shown, t)
    setChecked(true)
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
      if (wasRefused(entry.id)) {
        setFailure('refused')
        setBusy(false)
        return
      }
      onSaved('queued')
    } catch {
      // This phone cannot store data (for example private browsing),
      // so the only option is to send straight away.
      const result = await postEntry(entry)
      if (result === 'sent') {
        onSaved('sent')
      } else {
        setFailure(result === 'refused' ? 'refused' : 'notSent')
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
          <span>{field.required ? t.required : t.optional}</span>
        </div>
        {field.hint && <p className="hint">{field.hint}</p>}
        {shownErrors[field.key] && <p className="error">{shownErrors[field.key]}</p>}
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
      error: shownErrors[field.key],
      marks: [t.required, t.optional] as [string, string],
    }
    switch (field.builtin ? field.key : '') {
      case 'date':
        return (
          <Field {...common}>
            <input
              id={field.key}
              type="date"
              value={values.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </Field>
        )
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
                  {choice(who)}
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
              {/* Shown only if the office turns this question back on.
                  Aadhaar is not asked for; older entries may still have it. */}
              {(['PAN ID', 'Other'] as const).map((type, i) => (
                <label key={type}>
                  <input
                    id={i === 0 ? field.key : undefined}
                    type="radio"
                    name="kycType"
                    checked={values.kycType === type}
                    onChange={() => set({ kycType: type })}
                  />
                  {choice(type)}
                </label>
              ))}
            </div>
            {values.kycType === 'Other' && (
              <input
                className="gap"
                aria-label={t.whichDocument}
                placeholder={t.whichDocument}
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
              aria-label={t.shortenList}
              placeholder={t.typeToShorten}
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
            />
            <select
              id={field.key}
              value={values.channel}
              onChange={(e) => set({ channel: e.target.value })}
            >
              <option value="">
                {channels.length === 0 ? t.nothingMatches : t.chooseCount(channels.length)}
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
              choose={t.choose}
            />
          </Field>
        )
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head">
        <h2>{t.farmerDetails}</h2>
      </div>

      <div className="card-body form-grid">{shown.map(question)}</div>

      <div className="card-foot">
        {failure ? (
          <p className="grow error" role="alert">
            {t[failure]}
          </p>
        ) : (
          <p className="grow">{t.privacy(DEPARTMENT)}</p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? t.saving : t.submit}
        </button>
      </div>
    </form>
  )
}

export default FarmerForm
