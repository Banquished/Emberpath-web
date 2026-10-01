import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useIsMutating } from '@tanstack/react-query'
import type { WeightGoal } from '@/entities/weight-goal'
import { useActiveWeightGoal, useEndWeightGoal, useSaveWeightGoal } from '../api/weight-goals'
import { dateKey } from '../weight-range'
import { InfoDisclosure } from './info-disclosure'

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T12:00:00`))
const paceFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })
const endMessages = { completed: 'Goal completed.', cancelled: 'Goal cancelled.' } as const

function GoalPace({ goal }: { goal: WeightGoal }) {
  if (!goal.target_date) return null
  return <div className="goal-pace">
    <InfoDisclosure label="About the planned pace">
      {goal.plan
        ? <p>Planned pace: {paceFormatter.format(goal.plan.weekly_change_kg)} kg/week ({paceFormatter.format(goal.plan.fortnightly_change_kg)} kg/fortnight), from {goal.baseline_weight_kg} kg over {goal.plan.duration_days} days. This is your chosen plan, not a prediction.</p>
        : <p>Change your goal to set its starting weight and show a planned pace.</p>}
    </InfoDisclosure>
  </div>
}

type EndStatus = keyof typeof endMessages

function GoalEndSection({ busy, pending, error, onEnd }: { busy: boolean; pending?: EndStatus; error?: string; onEnd: (status: EndStatus) => void }) {
  return (
    <section className="goal-end" aria-labelledby="goal-end-title">
      <h3 id="goal-end-title">Finish this goal</h3>
      <p>Reaching your target does not complete a goal automatically. Completing or cancelling removes it from the chart and keeps it in your goal history.</p>
      <div className="entry-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={() => onEnd('completed')}>{pending === 'completed' ? 'Completing...' : 'Mark completed'}</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => onEnd('cancelled')}>{pending === 'cancelled' ? 'Cancelling...' : 'Cancel goal'}</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  )
}

function GoalDialog({ goal, onClose, onDone }: { goal: WeightGoal | null; onClose: () => void; onDone: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const save = useSaveWeightGoal()
  const end = useEndWeightGoal()
  const busy = useIsMutating({ mutationKey: ['weight-goals'] }) > 0
  const [weight, setWeight] = useState(goal ? String(goal.target_weight_kg) : '')
  const [start, setStart] = useState(goal?.start_date ?? dateKey(new Date()))
  const [target, setTarget] = useState(goal?.target_date ?? '')
  const [baseline, setBaseline] = useState(goal?.baseline_weight_kg != null ? String(goal.baseline_weight_kg) : '')
  const firstTargetDate = new Date(`${start}T12:00:00`)
  firstTargetDate.setDate(firstTargetDate.getDate() + 1)
  const baselineHelp = goal?.baseline_weight_kg != null
    ? 'Leave blank to keep the saved starting weight if the start date is unchanged. Enter a value to replace it; with a changed start date, leaving it blank uses the latest measurement on or before that date.'
    : 'Leave blank to use your latest measurement on or before the start date.'
  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement as HTMLElement | null
    element.showModal()
    element.querySelector<HTMLInputElement>('#goal-weight')?.focus()
    return () => { element.close(); if (trigger?.isConnected) trigger.focus() }
  }, [])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    end.reset()
    save.mutate({ target_weight_kg: Number(weight), start_date: start, target_date: target || null, baseline_weight_kg: baseline ? Number(baseline) : null }, { onSuccess: () => onDone('Goal saved.') })
  }
  function endGoal(status: EndStatus) {
    if (!goal || !window.confirm(status === 'completed' ? 'Mark this weight goal as completed? It will leave the chart. Your previous goal will be saved.' : 'Cancel this weight goal? It will leave the chart. Your previous goal will be saved.')) return
    save.reset()
    end.mutate({ id: goal.id, status }, { onSuccess: () => onDone(endMessages[status]) })
  }
  return (
    <dialog ref={dialog} className="weight-dialog" aria-labelledby="goal-editor-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
      <section className="weight-entry">
        <div className="entry-heading">
          <h2 id="goal-editor-title">{goal ? 'Manage weight goal' : 'Set weight goal'}</h2>
          <p>{goal ? 'Saving a changed goal replaces your current goal and preserves its history.' : 'Choose your own target, with an optional date.'}</p>
          {goal && <GoalPace goal={goal} />}
        </div>
        <form onSubmit={submit}>
          <fieldset disabled={busy} className="entry-fields goal-fields">
            <legend className="sr-only">Goal details</legend>
            <div className="form-field">
              <label htmlFor="goal-weight">Target weight (kg)</label>
              <input id="goal-weight" type="number" inputMode="decimal" min="0.01" max="9999.99" step="0.01" required value={weight} onChange={(event) => setWeight(event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="goal-start">Start date</label>
              <input id="goal-start" type="date" required value={start} onChange={(event) => setStart(event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="goal-target">Target date (optional)</label>
              <input id="goal-target" type="date" min={start ? dateKey(firstTargetDate) : undefined} value={target} onChange={(event) => setTarget(event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="goal-baseline">Starting weight (kg, optional)</label>
              <input id="goal-baseline" type="number" inputMode="decimal" min="0.01" max="9999.99" step="0.01" value={baseline} onChange={(event) => setBaseline(event.target.value)} aria-describedby="goal-baseline-help" />
            </div>
            <p id="goal-baseline-help" className="goal-form-help">{baselineHelp} If no starting measurement exists, enter a starting weight for a dated goal. This starting point stays fixed as you log measurements.</p>
            <div className="entry-actions">
              <button className="log-button" type="submit">{save.isPending ? 'Saving...' : 'Save goal'}</button>
              <button className="secondary-button" type="button" onClick={onClose}>Close</button>
            </div>
          </fieldset>
          {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
        </form>
        {goal && <GoalEndSection busy={busy} pending={end.isPending ? end.variables?.status : undefined} error={end.error?.message} onEnd={endGoal} />}
      </section>
    </dialog>
  )
}

export function WeightGoalTile() {
  const query = useActiveWeightGoal()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const goal = query.data ?? null
  return (
    <div className="weight-goal-tile">
      <dt>Weight goal</dt>
      <dd>
        {query.isPending && <span role="status">Loading goal…</span>}
        {query.isSuccess && <div className="goal-tile-body">
          <span className={goal ? 'goal-tile-value' : 'goal-tile-value goal-tile-empty'}>{goal ? `${goal.target_weight_kg} kg` : 'Not set'}</span>
          <span className="goal-tile-note">{goal ? (goal.target_date ? `By ${formatDate(goal.target_date)}` : 'No target date') : 'Add a target when it feels right for you'}</span>
          <button className="goal-tile-action" type="button" onClick={() => { setMessage(''); setOpen(true) }}>{goal ? 'Manage goal' : 'Set goal'}</button>
        </div>}
        {query.isError && <>
          <span role="alert">Could not load your goal. {query.error.message}</span>
          <button className="secondary-button" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry goal</button>
        </>}
        <span className="goal-tile-status" role="status">{message}</span>
      </dd>
      {open && createPortal(<GoalDialog goal={goal} onClose={() => setOpen(false)} onDone={(text) => { setOpen(false); setMessage(text) }} />, document.body)}
    </div>
  )
}
