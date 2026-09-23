import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import type { WeightGoal } from '@/entities/weight-goal'
import { useActiveWeightGoal, useEndWeightGoal, useSaveWeightGoal } from '../api/weight-goals'
import { dateKey } from '../weight-range'

const formatDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`))

function GoalDialog({ goal, onClose, onSaved }: { goal: WeightGoal | null; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const save = useSaveWeightGoal()
  const [weight, setWeight] = useState(goal ? String(goal.target_weight_kg) : '')
  const [start, setStart] = useState(goal?.start_date ?? dateKey(new Date()))
  const [target, setTarget] = useState(goal?.target_date ?? '')
  const [baseline, setBaseline] = useState(goal?.baseline_weight_kg != null ? String(goal.baseline_weight_kg) : '')
  const firstTargetDate = new Date(`${start}T12:00:00`)
  firstTargetDate.setDate(firstTargetDate.getDate() + 1)
  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement as HTMLElement | null
    element.showModal()
    element.querySelector<HTMLInputElement>('#goal-weight')?.focus()
    return () => { element.close(); if (trigger?.isConnected) trigger.focus() }
  }, [])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    save.mutate({ target_weight_kg: Number(weight), start_date: start, target_date: target || null, baseline_weight_kg: baseline ? Number(baseline) : null }, { onSuccess: onSaved })
  }
  return <dialog ref={dialog} className="weight-dialog" aria-labelledby="goal-editor-title" onCancel={(event) => { event.preventDefault(); if (!save.isPending) onClose() }}>
    <section className="weight-entry">
      <div className="entry-heading"><h2 id="goal-editor-title">{goal ? 'Change weight goal' : 'Set weight goal'}</h2><p>{goal ? 'Saving a changed goal replaces your current goal and preserves its history.' : 'Choose your own target, with an optional date.'}</p></div>
      <form onSubmit={submit}>
        <fieldset disabled={save.isPending} className="entry-fields goal-fields">
          <legend className="sr-only">Goal details</legend>
          <div className="form-field"><label htmlFor="goal-weight">Target weight (kg)</label><input id="goal-weight" type="number" inputMode="decimal" min="0.01" max="9999.99" step="0.01" required value={weight} onChange={(event) => setWeight(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="goal-start">Start date</label><input id="goal-start" type="date" required value={start} onChange={(event) => setStart(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="goal-target">Target date (optional)</label><input id="goal-target" type="date" min={start ? dateKey(firstTargetDate) : undefined} value={target} onChange={(event) => setTarget(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="goal-baseline">Starting weight (kg, optional)</label><input id="goal-baseline" type="number" inputMode="decimal" min="0.01" max="9999.99" step="0.01" value={baseline} onChange={(event) => setBaseline(event.target.value)} aria-describedby="goal-baseline-help" /></div>
          <p id="goal-baseline-help" className="goal-form-help">{goal?.baseline_weight_kg != null ? 'Leave blank to keep the saved starting weight if the start date is unchanged. Enter a value to replace it; with a changed start date, leaving it blank uses the latest measurement on or before that date.' : 'Leave blank to use your latest measurement on or before the start date.'} If no starting measurement exists, enter a starting weight for a dated goal. This starting point stays fixed as you log measurements.</p>
          <div className="entry-actions"><button className="log-button" type="submit">{save.isPending ? 'Saving...' : 'Save goal'}</button><button className="secondary-button" type="button" onClick={onClose}>Cancel</button></div>
        </fieldset>
        {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
      </form>
    </section>
  </dialog>
}

export function WeightGoalPanel() {
  const query = useActiveWeightGoal()
  const end = useEndWeightGoal()
  const busy = useIsMutating({ mutationKey: ['weight-goals'] }) > 0
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('')
  const goal = query.data
  function endGoal(status: 'completed' | 'cancelled') {
    if (!goal || !window.confirm(status === 'completed' ? 'Mark this weight goal as completed? It will leave the chart. Your previous goal will be saved.' : 'Cancel this weight goal? It will leave the chart. Your previous goal will be saved.')) return
    setMessage('')
    end.mutate({ id: goal.id, status }, { onSuccess: () => setMessage(status === 'completed' ? 'Goal completed.' : 'Goal cancelled.') })
  }
  return <section className="weight-goal-panel" aria-labelledby="goal-title">
    <div className="goal-heading"><div><h2 id="goal-title">Your weight goal</h2>
      {query.isPending && <p role="status">Loading goal...</p>}
      {query.isSuccess && (goal ? <p><strong>{goal.target_weight_kg} kg</strong><span>Since {formatDate(goal.start_date)}{goal.target_date ? ` \u00b7 Target date ${formatDate(goal.target_date)}` : ' \u00b7 No target date'}</span></p> : <p>No active goal. Add a target when it feels right for you.</p>)}
    </div>
    {query.isSuccess && <div className="goal-actions"><button className="secondary-button" disabled={busy} onClick={() => { setEditing(true); setMessage(''); end.reset() }}>{goal ? 'Change goal' : 'Set goal'}</button>{goal && <><button className="secondary-button" disabled={busy} onClick={() => endGoal('completed')}>Mark completed</button><button className="secondary-button" disabled={busy} onClick={() => endGoal('cancelled')}>Cancel goal</button></>}</div>}
    </div>
    {goal?.plan && <p className="chart-help">Planned pace: {new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(goal.plan.weekly_change_kg)} kg/week ({new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(goal.plan.fortnightly_change_kg)} kg/fortnight), from {goal.baseline_weight_kg} kg over {goal.plan.duration_days} days. This is your chosen plan, not a prediction.</p>}
    {goal?.target_date && !goal.plan && <p className="chart-help">Change your goal to set its starting weight and show a planned pace.</p>}
    {query.isError && <div><p className="form-error" role="alert">Could not load your goal. {query.error.message}</p><button className="secondary-button" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry goal</button></div>}
    {end.error && <p className="form-error" role="alert">{end.error.message}</p>}
    <p role="status">{message}</p>
    {editing && <GoalDialog goal={goal ?? null} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setMessage('Goal saved.') }} />}
  </section>
}
