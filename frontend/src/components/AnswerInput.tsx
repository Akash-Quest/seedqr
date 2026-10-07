import type { FieldSpec } from '../data/forms'

type AnswerInputProps = {
  field: FieldSpec
  value: string
  onChange: (value: string) => void
}

// The input for a plain question: short or long text, number, date or a list.
function AnswerInput({ field, value, onChange }: AnswerInputProps) {
  if (field.type === 'textarea') {
    return (
      <textarea
        id={field.key}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  if (field.type === 'select') {
    return (
      <select id={field.key} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {field.options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    )
  }
  return (
    <input
      id={field.key}
      type={field.type === 'date' ? 'date' : 'text'}
      inputMode={field.type === 'number' ? 'decimal' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
    />
  )
}

export default AnswerInput
