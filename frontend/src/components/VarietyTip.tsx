// The most varieties listed before the rest are only counted.
const MOST = 8

type VarietyTipProps = {
  // Entries per variety of one crop, in the period shown.
  varieties?: Record<string, number>
}

// A small box under a crop's name, shown while it is pointed at, with the
// varieties the crop's entries were for. Its parent needs the "has-tip"
// class, which places it and shows it on hover.
function VarietyTip({ varieties }: VarietyTipProps) {
  // Sorted again: a variety named like a number would otherwise come first.
  const rows = Object.entries(varieties ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (rows.length === 0) return null
  const rest = rows.length - MOST
  // Each variety's share of the crop's entries, all varieties counted.
  const whole = rows.reduce((sum, [, count]) => sum + count, 0)
  const share = (count: number) => {
    const percent = (count / whole) * 100
    return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`
  }

  return (
    <span className="variety-tip" role="tooltip">
      <span className="variety-tip-title">
        {rows.length === 1 ? '1 variety' : `${rows.length} varieties`}
      </span>
      {rows.slice(0, MOST).map(([name, count]) => (
        <span key={name} className="variety-tip-row">
          <span>{name}</span>
          <strong>{count.toLocaleString('en-IN')}</strong>
          <em>{share(count)}</em>
        </span>
      ))}
      {rest > 0 && <span className="variety-tip-more">and {rest} more</span>}
    </span>
  )
}

export default VarietyTip
