import { lazy, Suspense, useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import type { WeightLog } from '@/entities/weight-log'
import { useDeleteWeightLog, useWeightLogs } from '../api/weight-logs'
import { filterMeasurements, periodBounds, type Period } from '../weight-range'
import { goalPreviewEnd } from '../weight-chart-window'
import { useActiveWeightGoal } from '../api/weight-goals'
import { WeightGoalTile } from './weight-goal'
import { WeightSummary } from './weight-summary'
import { WeightTransfer } from './weight-transfer'
import { WeightHistory } from './weight-history'
import { WeightLogDialog } from './weight-log-dialog'
import { WeightWorkspace } from './weight-workspace'
import './weight-dashboard.css'

const WeightChart = lazy(() => import('./weight-chart').then((module) => ({ default: module.WeightChart })))
const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function WeightPage() {
  const history = useWeightLogs()
  const goal = useActiveWeightGoal()
  const remove = useDeleteWeightLog()
  const busy = useIsMutating({ mutationKey: ['weight-logs'] }) > 0
  const [dialog, setDialog] = useState<{ entry: WeightLog | null } | null>(null)
  const [period, setPeriod] = useState<Period>('1m')
  const [message, setMessage] = useState('')
  const now = new Date()
  const bounds = periodBounds(period, now)
  const entries = filterMeasurements(history.data ?? [], period, now)

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
    </div>
    <WeightSummary start={bounds.start} end={bounds.end}><WeightGoalTile /></WeightSummary>
    <WeightWorkspace
      period={period}
      onPeriodChange={setPeriod}
      measurementCount={history.data && entries.length}
      busy={busy}
      onLog={() => { setDialog({ entry: null }); setMessage('') }}
      notice={<>
        <p className="save-status" role="status">{message}</p>
        {remove.error && <p className="form-error" role="alert">{remove.error.message}</p>}
        {history.isPending && <p className="history-notice" role="status">Loading measurements…</p>}
        {history.isError && <div className="history-notice"><p className="form-error" role="alert">{history.error.message}</p><button className="secondary-button" disabled={history.isFetching} onClick={() => void history.refetch()}>{history.isFetching ? 'Retrying…' : 'Retry'}</button></div>}
        {history.data?.length === 0 && <p className="history-notice">No measurements yet</p>}
      </>}
      chart={history.data && <Suspense fallback={<div className="chart-empty" role="status">Loading chart…</div>}><WeightChart goal={goal.isError ? null : goal.data} entries={entries} start={bounds.start} end={bounds.end} previewEnd={goalPreviewEnd(period, now)} /></Suspense>}
      history={history.data && <WeightHistory period={period} entries={entries} busy={busy} onEdit={(entry) => { setDialog({ entry }); setMessage('') }} onDelete={deleteEntry} />}
    />
    <WeightTransfer busy={busy} />
    {dialog && <WeightLogDialog entry={dialog.entry} busy={busy} onClose={() => setDialog(null)} onSaved={() => {
      setMessage(dialog.entry ? 'Measurement updated.' : 'Measurement saved.')
      setDialog(null)
    }} />}
  </section>
}
