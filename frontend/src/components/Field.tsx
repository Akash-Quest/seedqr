import type { ReactNode } from 'react'

type FieldProps = {
  id: string
  label: string
  // Shows "Required" or "Optional" on the right of the label. Leave out for neither.
  optional?: boolean
  hint?: string
  error?: string
  className?: string
  // The words for "Required" and "Optional", for a form in another language.
  marks?: [required: string, optional: string]
  children: ReactNode
}

function Field({
  id,
  label,
  optional,
  hint,
  error,
  className = '',
  marks = ['Required', 'Optional'],
  children,
}: FieldProps) {
  return (
    <div className={`field ${error ? 'bad' : ''} ${className}`}>
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        {optional !== undefined && <span>{optional ? marks[1] : marks[0]}</span>}
      </div>
      {hint && <p className="hint">{hint}</p>}
      {error && <p className="error">{error}</p>}
      {children}
    </div>
  )
}

export default Field
