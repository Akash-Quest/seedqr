import { CHANNELS } from './channels'

// The questions on the two forms, which the office can change on the
// Barcode page. Mirrors backend/app/forms.py, which is the real source:
// these defaults are only used by a phone that saved a lot before forms
// could be changed.

export type FieldType =
  // Any question.
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'textarea'
  // Built-in questions with their own controls on the farmer form.
  | 'choice'
  | 'kyc'
  | 'phone'
  | 'channel'

export type FieldSpec = {
  key: string
  label: string
  hint: string
  type: FieldType
  // Choices for 'select' (and the fixed ones for 'choice').
  options: string[]
  required: boolean
  hidden: boolean
  // Built in: has its own column and cannot be removed.
  builtin: boolean
  // Needed by the rest of the app, so always required and shown.
  core: boolean
}

export type Forms = { lot: FieldSpec[]; farmer: FieldSpec[] }

// The types the office can pick for a question it adds.
export const CUSTOM_TYPES: [FieldType, string][] = [
  ['text', 'Short answer'],
  ['textarea', 'Long answer'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['select', 'Choose from a list'],
]

function builtin(
  key: string,
  label: string,
  type: FieldType = 'text',
  extra: Partial<FieldSpec> = {},
): FieldSpec {
  return {
    key, label, type, hint: '', options: [], required: true, hidden: false,
    builtin: true, core: false, ...extra,
  }
}

export const DEFAULT_FORMS: Forms = {
  lot: [
    builtin('date', 'Date', 'date', { core: true }),
    builtin('seedType', 'Seed type', 'text', { hint: 'For example hybrid, certified or foundation' }),
    builtin('crop', 'Crop intended for sowing', 'text', { core: true }),
    builtin('variety', 'Variety', 'text', { core: true }),
    builtin('batchNo', 'Batch/lot number', 'text', { core: true }),
    builtin('productionSource', 'Production source'),
    builtin('certification', 'Certification details', 'text', { required: false }),
    builtin('expiryDate', 'Expiry date', 'date', { required: false }),
    builtin('storageLocation', 'Storage location'),
    builtin('packingLocation', 'Packing location', 'text', { required: false }),
  ],
  farmer: [
    builtin('date', 'Date', 'date'),
    builtin('filledBy', 'Who is filling this in?', 'choice', { options: ['Farmer', 'Field officer'] }),
    builtin('farmerName', 'Farmer name', 'text', { core: true }),
    // Not asked for (see backend/app/forms.py); the office can show them again.
    builtin('kycType', 'Document / KYC type', 'kyc', { required: false, hidden: true }),
    builtin('idNumber', 'ID number', 'text', { required: false, hidden: true }),
    builtin('contact', 'Contact number', 'phone', { required: false }),
    builtin('channel', 'Distribution channel', 'channel', {
      hint: 'The list is long. Type part of the name or village to shorten it.',
      options: CHANNELS,
    }),
    builtin('landholding', 'Landholding size', 'text', { required: false }),
    builtin('quantity', 'Quantity of seed given'),
  ],
}

// A key for a question the office adds, like "c_k3f9x2".
export function newFieldKey(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let key = 'c_'
  for (let i = 0; i < 8; i++) key += letters[Math.floor(Math.random() * letters.length)]
  return key
}

// The answer to a question, whether built in or added by the office.
export function answer(
  record: object & { extra?: Record<string, string> | null },
  field: FieldSpec,
): string {
  if (!field.builtin) return record.extra?.[field.key] ?? ''
  const value = (record as Record<string, unknown>)[field.key]
  return typeof value === 'string' ? value : ''
}

// Checks one answer to a question the office added. Returns an error or ''.
export function checkCustom(field: FieldSpec, value: string): string {
  const v = value.trim()
  if (v === '') return field.required ? `Enter ${field.label.toLowerCase()}` : ''
  if (field.type === 'number' && !Number.isFinite(Number(v))) return 'Enter a number'
  return ''
}
