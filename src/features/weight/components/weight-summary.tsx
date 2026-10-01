import type { ReactNode } from 'react'
import type { WeightSummary as PeriodSummary } from '@/entities/weight-summary'
import { useWeightSummary } from '../api/weight-logs'

const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })
const signedNumber = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })
const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const weight = (value: number | null) => value === null ? '\u2014' : `${number.format(value)} kg`
const measurementDate = (value?: string) => value ? date.format(new Date(`${value}T12:00:00`)) : 'No measurements'

function PeriodTiles({ data }: { data: PeriodSummary }) {
  return <>
    <div><dt>Measurements</dt><dd>{number.format(data.measurement_count)}<span>Recorded in this period</span></dd></div>
    <div><dt>Mean weight</dt><dd>{weight(data.mean_weight_kg)}<span>Recorded days only</span></dd></div>
    <div><dt>First measurement</dt><dd>{weight(data.first?.weight_kg ?? null)}<span>{measurementDate(data.first?.date)}</span></dd></div>
    <div><dt>Latest measurement</dt><dd>{weight(data.latest?.weight_kg ?? null)}<span>{measurementDate(data.latest?.date)}</span></dd></div>
    <div><dt>Change</dt><dd>{data.change_kg === null ? '\u2014' : `${signedNumber.format(data.change_kg)} kg`}<span>{data.change_percent === null ? (data.measurement_count === 1 ? 'Add another measurement' : 'Needs two measurements') : `${signedNumber.format(data.change_percent)}% from first to latest`}</span></dd></div>
  </>
}

export function WeightSummary({ start, end, children }: { start?: string; end?: string; children?: ReactNode }) {
  const summary = useWeightSummary(start, end)
  return <section aria-label="Weight summary" className="weight-summary">
    <dl className="weight-summary-grid">
      {summary.isPending && <div className="weight-summary-notice"><dt>Period summary</dt><dd><span role="status">Loading period summary…</span></dd></div>}
      {summary.isError && <div className="weight-summary-notice">
        <dt>Period summary</dt>
        <dd>
          <span role="alert">Could not load the period summary. {summary.error.message}</span>
          <button className="secondary-button" type="button" disabled={summary.isFetching} onClick={() => void summary.refetch()}>{summary.isFetching ? 'Retrying summary…' : 'Retry summary'}</button>
        </dd>
      </div>}
      {summary.isSuccess && <PeriodTiles data={summary.data} />}
      {children}
    </dl>
  </section>
}
