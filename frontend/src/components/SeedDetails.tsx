import { answer } from '../data/forms'
import type { FieldSpec } from '../data/forms'
import { formatDate } from '../data/types'
import type { SeedLot } from '../data/types'

type SeedDetailsProps = {
  lot: SeedLot
  // The seed details form, so labels and added questions match the office's.
  fields: FieldSpec[]
}

// The seed details as a plain list. Hidden and unanswered questions are left out.
function SeedDetails({ lot, fields }: SeedDetailsProps) {
  const rows = fields
    .filter((field) => !field.hidden)
    .map((field) => {
      const value = answer(lot, field)
      return [field.label, field.type === 'date' ? formatDate(value) : value] as const
    })
    .filter(([, value]) => value !== '')

  return (
    <dl className="details">
      {rows.map(([label, value]) => (
        <div key={label} className={value.length > 60 ? 'full' : ''}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default SeedDetails
