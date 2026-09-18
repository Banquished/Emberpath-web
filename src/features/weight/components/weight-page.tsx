import { useState } from 'react'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import type { WeightLog } from '@/entities/weight-log'
import { useDeleteWeightLog, weightLogsQuery } from '../api/weight-logs'
import { WeightLogForm } from './weight-log-form'

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const weightFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })

function displayDate(date: string) {
  return dateFormatter.format(new Date(`${date}T12:00:00`))
}

export function WeightPage() {
  const history = useQuery(weightLogsQuery)
  const remove = useDeleteWeightLog()
  const busy = useIsMutating({ mutationKey: ['weight-logs'] }) > 0
  const [editing, setEditing] = useState<WeightLog | null>(null)
  const [message, setMessage] = useState('')

  function deleteEntry(entry: WeightLog) {
    if (!window.confirm(`Delete the ${weightFormatter.format(entry.weight_kg)} kg measurement for ${displayDate(entry.date)}? This cannot be undone.`)) return
    setMessage('')
    remove.mutate(entry.id, {
      onSuccess: () => {
        if (editing?.id === entry.id) setEditing(null)
        setMessage('Measurement deleted.')
      },
    })
  }

  return (
    <section aria-labelledby="weight-title">
      <title>Weight · Emberpath</title>
      <div className="page-heading">
        <div>
          <h1 id="weight-title">Weight</h1>
          <p className="page-description">A place to follow your progress, at your pace.</p>
        </div>
      </div>

      <WeightLogForm key={editing?.id ?? 'new'} entry={editing} disabled={busy} onCancel={() => setEditing(null)} onSaved={() => {
        setMessage(editing ? 'Measurement updated.' : 'Measurement saved.')
        setEditing(null)
      }} />
      <p className="save-status" role="status">{message}</p>

      <section className="weight-history" aria-labelledby="history-title">
        <header className="history-heading">
          <h2 id="history-title">Weight history</h2>
          <span className="unit-label">Kilograms</span>
        </header>
        {history.isPending && <p className="history-notice" role="status">Loading measurements…</p>}
        {history.isError && <div className="history-notice">
          <p className="form-error" role="alert">{history.error.message}</p>
          <button className="secondary-button" type="button" disabled={history.isFetching} onClick={() => void history.refetch()}>{history.isFetching ? 'Retrying…' : 'Retry'}</button>
        </div>}
        {remove.error && <p className="form-error history-notice" role="alert">{remove.error.message}</p>}
        {history.data?.length === 0 && !history.isError && <div className="weight-empty">
          <div className="empty-symbol" aria-hidden="true"><img src="/brand/logos/emberpath-mark.svg" alt="" width="44" height="48" /></div>
          <h3>No measurements yet</h3>
          <p>Add your first weight above. Your daily measurements will appear here.</p>
        </div>}
        {!!history.data?.length && <ul className="measurement-list">
          {history.data.map((entry) => <li key={entry.id} className="measurement-row">
            <div className="measurement-values">
              <time dateTime={entry.date}>{displayDate(entry.date)}</time>
              <span className="measurement-weight">{weightFormatter.format(entry.weight_kg)} <span>kg</span></span>
            </div>
            <div className="measurement-actions">
              <button className="secondary-button" type="button" disabled={busy} aria-label={`Edit measurement for ${displayDate(entry.date)}`} onClick={() => { setEditing(entry); setMessage('') }}>Edit</button>
              <button className="secondary-button delete-button" type="button" disabled={busy} aria-label={`Delete measurement for ${displayDate(entry.date)}`} onClick={() => deleteEntry(entry)}>{remove.isPending && remove.variables === entry.id ? 'Deleting…' : 'Delete'}</button>
            </div>
          </li>)}
        </ul>}
        <div className="history-footer">{history.data?.length ? `${history.data.length} measurement${history.data.length === 1 ? '' : 's'} · Most recent first` : 'A little check-in, one day at a time.'}</div>
      </section>
    </section>
  )
}
