import { useCountUp } from '../data/motion'

// A number that runs up to its value. Screen readers get the value itself,
// never the numbers flicking past on the way.
function CountUp({ value, suffix = '' }: { value: number; suffix?: string }) {
  const shown = useCountUp(value)
  return (
    <>
      <span aria-hidden="true">
        {shown.toLocaleString('en-IN')}
        {suffix}
      </span>
      <span className="visually-hidden">
        {value.toLocaleString('en-IN')}
        {suffix}
      </span>
    </>
  )
}

export default CountUp
