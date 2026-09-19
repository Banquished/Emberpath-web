import { lazy, Suspense, useState } from 'react'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import type { WeightLog } from '@/entities/weight-log'
import { useDeleteWeightLog, weightLogsQuery } from '../api/weight-logs'
import { filterMeasurements, periods, type Period } from '../weight-range'
import { WeightHistory } from './weight-history'
import { WeightLogDialog } from './weight-log-dialog'
import './weight-dashboard.css'

const WeightChart = lazy(() => import('./weight-chart').then((module) => ({ default: module.WeightChart })))
const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function WeightPage() {
  const history = useQuery(weightLogsQuery)
  const remove = useDeleteWeightLog()
  const busy = useIsMutating({ mutationKey: ['weight-logs'] }) > 0
  const [dialog, setDialog] = useState<{ entry: WeightLog | null } | null>(null)
  const [period, setPeriod] = useState<Period>('1m')
  const [message, setMessage] = useState('')
  const entries = filterMeasurements(history.data ?? [], period, new Date())

  function deleteEntry(entry: WeightLog) {
    const date = dateFormatter.format(new Date(`${entry.date}T12:00:00`))
    if (!window.confirm(`Delete the ${entry.weight_kg} kg measurement for ${date}? This cannot be undone.`)) return
    setMessage('')
    remove.mutate(entry.id, { onSuccess: () => setMessage('Measurement deleted.') })
  }

  return <section aria-labelledby="weight-title" className="weight-dashboard">
    <title>Weight · Emberpath</title>
    <div className="page-heading">
      <div><h1 id="weight-title">Weight</h1><p className="page-description">A place to follow your progress, at your pace.</p></div>
      <button className="log-button" disabled={busy} onClick={() => { setDialog({ entry: null }); setMessage('') }}>Log weight</button>
    </div>
    <div className="period-toolbar">
      <div className="period-buttons" role="group" aria-label="Measurement period">
        {periods.map((option) => <button key={option.value} aria-label={option.label} aria-pressed={period === option.value} onClick={() => setPeriod(option.value)}>{option.short}</button>)}
      </div>
      <label className="period-select">Period<select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{periods.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <span className="unit-label">{periods.find((option) => option.value === period)?.label}{history.data && ` · ${entries.length} measurements`}</span>
    </div>
    {history.isPending && <p className="history-notice" role="status">Loading measurements…</p>}
    {history.isError && <div className="history-notice"><p className="form-error" role="alert">{history.error.message}</p><button className="secondary-button" disabled={history.isFetching} onClick={() => void history.refetch()}>{history.isFetching ? 'Retrying…' : 'Retry'}</button></div>}
    {history.data && <>
      {history.data.length === 0 && <p className="history-notice">No measurements yet</p>}
      <Suspense fallback={<div className="weight-chart-panel chart-empty" role="status">Loading chart…</div>}><WeightChart entries={entries} /></Suspense>
      <WeightHistory key={period} entries={entries} busy={busy} onEdit={(entry) => { setDialog({ entry }); setMessage('') }} onDelete={deleteEntry} />
    </>}
    <p className="save-status" role="status">{message}</p>
    {remove.error && <p className="form-error" role="alert">{remove.error.message}</p>}
    {dialog && <WeightLogDialog entry={dialog.entry} busy={busy} onClose={() => setDialog(null)} onSaved={() => {
      setMessage(dialog.entry ? 'Measurement updated.' : 'Measurement saved.')
      setDialog(null)
    }} />}
  </section>
}
