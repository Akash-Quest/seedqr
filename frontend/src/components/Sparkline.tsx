// A small line of how a number moved over the period, drawn in a stat
// tile. Decoration beside the number: the chart below has the values.
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const width = 120
  const height = 32
  const top = Math.max(1, ...values)
  const step = width / (values.length - 1)
  const line = values
    .map((value, i) => `${(i * step).toFixed(1)},${(height - 3 - (value / top) * (height - 6)).toFixed(1)}`)
    .join(' ')

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon className="sparkline-area" points={`0,${height} ${line} ${width},${height}`} />
      <polyline className="sparkline-line" points={line} />
    </svg>
  )
}

export default Sparkline
