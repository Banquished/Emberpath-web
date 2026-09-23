import { useWeightSummary } from '../api/weight-logs'

const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })
const signedNumber = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })
const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const weight = (value: number | null) => value === null ? '\u2014' : `${number.format(value)} kg`
const measurementDate = (value?: string) => value ? date.format(new Date(`${value}T12:00:00`)) : 'No measurements'

export function WeightSummary({ start, end }: { start?: string; end?: string }) {
  const summary = useWeightSummary(start, end)
  if (summary.isPending) return <div className="weight-summary-notice" role="status">Loading period summary…</div>
  if (summary.isError) return <div className="weight-summary-notice">
    <p className="form-error" role="alert">Could not load the period summary. {summary.error.message}</p>
    <button className="secondary-button" disabled={summary.isFetching} onClick={() => void summary.refetch()}>{summary.isFetching ? 'Retrying summary…' : 'Retry summary'}</button>
  </div>
  const data = summary.data
  return <section aria-label="Period summary" className="weight-summary">
    <dl className="weight-summary-grid">
      <div><dt>Measurements</dt><dd>{number.format(data.measurement_count)}<span>Recorded in this period</span></dd></div>
      <div><dt>Mean weight</dt><dd>{weight(data.mean_weight_kg)}<span>Recorded days only</span></dd></div>
      <div><dt>First measurement</dt><dd>{weight(data.first?.weight_kg ?? null)}<span>{measurementDate(data.first?.date)}</span></dd></div>
      <div><dt>Latest measurement</dt><dd>{weight(data.latest?.weight_kg ?? null)}<span>{measurementDate(data.latest?.date)}</span></dd></div>
      <div><dt>Change</dt><dd>{data.change_kg === null ? '\u2014' : `${signedNumber.format(data.change_kg)} kg`}<span>{data.change_percent === null ? (data.measurement_count === 1 ? 'Add another measurement' : 'Needs two measurements') : `${signedNumber.format(data.change_percent)}% from first to latest`}</span></dd></div>
    </dl>
  </section>
}
