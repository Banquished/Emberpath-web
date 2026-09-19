import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { WeightLog } from '@/entities/weight-log'
import { useSaveWeightLog } from '../api/weight-logs'

function localDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

interface WeightLogFormProps {
  entry: WeightLog | null
  onSaved: () => void
  onCancel: () => void
  disabled: boolean
}

export function WeightLogForm({ entry, onSaved, onCancel, disabled }: WeightLogFormProps) {
  const [date, setDate] = useState(entry?.date ?? localDate)
  const [weight, setWeight] = useState(entry ? String(entry.weight_kg) : '')
  const weightInput = useRef<HTMLInputElement>(null)
  const save = useSaveWeightLog()

  useEffect(() => {
    if (entry) weightInput.current?.focus()
  }, [entry])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    save.mutate({ id: entry?.id, input: { date, weight_kg: Number(weight) } }, {
      onSuccess: () => {
        setWeight('')
        onSaved()
        weightInput.current?.focus()
      },
    })
  }

  return (
    <section className="weight-entry" aria-labelledby="entry-title">
      <div className="entry-heading">
        <h2 id="entry-title">{entry ? 'Edit measurement' : 'Log your weight'}</h2>
        <p>One measurement a day, at your pace.</p>
      </div>
      <form onSubmit={submit} aria-label={entry ? 'Edit measurement' : 'Log your weight'}>
        <fieldset disabled={disabled} className="entry-fields">
          <legend className="sr-only">Measurement details</legend>
          <div className="form-field">
            <label htmlFor="weight-date">Date</label>
            <input id="weight-date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="weight-value">Weight (kg)</label>
            <input ref={weightInput} id="weight-value" type="number" inputMode="decimal" min="0.01" max="9999.99" step="0.01" required placeholder="e.g. 82.5" value={weight} onChange={(event) => setWeight(event.target.value)} />
          </div>
          <div className="entry-actions">
            <button className="log-button" type="submit">{save.isPending ? 'Saving…' : entry ? 'Save changes' : 'Save weight'}</button>
            <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
          </div>
        </fieldset>
        {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
      </form>
    </section>
  )
}
