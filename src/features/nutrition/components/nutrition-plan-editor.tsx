import { useId, useState, type FormEvent } from 'react'
import { weekdays, type ActivePlanResponse, type SavedPlan, type SavePlanRequest } from '@/entities/nutrition-plan'
import type { PreviewResponse } from '@/entities/nutrition-preview'
import { NutritionRequestError } from '../api/nutrition-request'
import { usePlanAllocationPreview, useReplaceNutritionPlan, useSaveNutritionPlan } from '../api/nutrition-plans'
import { weekdayLabel } from '../weekday-label'
import { RequestFailure } from './nutrition-request-failure'
import { WeekdayTargets } from './nutrition-weekdays'

const kcal = new Intl.NumberFormat('en-GB')
const difference = new Intl.NumberFormat('en-GB', { signDisplay: 'exceptZero' })

function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
}

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
    return true
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}

function parseWeekdays(values: string[], average: number) {
  if (values.length !== weekdays.length || values.some((value) => !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 20000)) {
    return { kcals: null, remaining: null }
  }
  const kcals = values.map(Number)
  return { kcals, remaining: average * weekdays.length - kcals.reduce((total, day) => total + day, 0) }
}

export function NutritionPlanEditor({ acceptedPreview, activeState, savedAllocation, onSaved, onCancel, onRefreshActive }: {
  acceptedPreview: PreviewResponse
  activeState: ActivePlanResponse | null
  savedAllocation?: SavedPlan
  onSaved: (plan: SavedPlan) => void
  onCancel: () => void
  onRefreshActive: () => void
}) {
  const id = useId()
  const average = acceptedPreview.daily_target.kcal
  const suggestedZone = browserTimeZone()
  const [values, setValues] = useState(() => savedAllocation
    ? savedAllocation.weekdays.map((day) => String(day.target.kcal))
    : weekdays.map(() => String(average)))
  const [editRevision, setEditRevision] = useState(0)
  const [timeZone, setTimeZone] = useState(() => savedAllocation?.time_zone ?? suggestedZone)
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [revisionConflict, setRevisionConflict] = useState<NutritionRequestError | null>(null)
  const draft = parseWeekdays(values, average)
  const balanced = draft.remaining === 0 && draft.kcals !== null
  const savedAllocationCurrent = !!savedAllocation && !!activeState?.plan &&
    activeState.plan.id === savedAllocation.id && activeState.plan.version === savedAllocation.version
  const allocationSource = savedAllocation
    ? savedAllocationCurrent && activeState
      ? { kind: 'active' as const, planId: savedAllocation.id, expectedRevision: activeState.revision }
      : null
    : { kind: 'new' as const, acceptedPreview }
  const allocation = usePlanAllocationPreview(allocationSource, balanced ? draft.kcals : null, editRevision)
  const save = useSaveNutritionPlan()
  const replace = useReplaceNutritionPlan()
  const replacing = !!savedAllocation || !!activeState?.plan
  const operation = replacing ? replace : save
  const reviewed = balanced && allocation.isSuccess && !allocation.isFetching ? allocation.data : null
  const staleSavedReview = !!savedAllocation && allocation.isError && allocation.error instanceof NutritionRequestError &&
    (allocation.error.kind === 'not-found' || allocation.error.kind === 'conflict')
  const zoneError = !timeZone.trim() ? 'Enter an IANA time zone to save a plan.' : timeZone.length > 128 ? 'The time zone must be at most 128 characters.' : !isValidTimeZone(timeZone.trim()) ? 'Enter a valid IANA time zone.' : ''
  const saving = save.isPending || replace.isPending
  const requestError = revisionConflict ?? operation.error
  const savedVersionCurrent = activeState === null || !savedAllocation || savedAllocationCurrent
  const canSave = activeState !== null && savedVersionCurrent && reviewed !== null && !zoneError && !revisionConflict && !staleSavedReview && (!reviewed.acknowledgment_required || acknowledged) && !saving

  function changeDay(index: number, value: string) {
    setValues((current) => current.map((day, currentIndex) => currentIndex === index ? value : day))
    setEditRevision((current) => current + 1)
    setAcknowledged(false)
    setSubmitError('')
    operation.reset()
  }

  function changeZone(value: string) {
    setTimeZone(value)
    setAcknowledged(false)
    setSubmitError('')
    operation.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave || !draft.kcals || !reviewed || !activeState) {
      setSubmitError('Review a balanced server allocation, time zone and current saved-plan revision before saving.')
      return
    }
    const request: SavePlanRequest = {
      accepted_preview: acceptedPreview,
      weekday_kcal: draft.kcals,
      expected_revision: activeState.revision,
      time_zone: timeZone.trim(),
    }
    if (reviewed.acknowledgment_required) request.acknowledge_day_allocation_risk = true
    setAcknowledged(false)
    setSubmitError('')
    operation.mutate(request, {
      onSuccess: (response) => { if (response.plan) onSaved(response.plan) },
      onError: (error) => {
        if (error instanceof NutritionRequestError && error.kind === 'conflict') setRevisionConflict(error)
      },
    })
  }

  return (
    <section className="mt-7 rounded-2xl border border-border-subtle bg-surface p-5 sm:p-8" aria-labelledby={`${id}-title`}>
      <h3 className="text-xl font-semibold" id={`${id}-title`}>{savedAllocation ? 'Edit saved weekday allocation' : replacing ? 'Review a replacement plan' : 'Review a new plan'}</h3>
      <p className="mt-2 text-sm text-text-secondary">This draft starts with {savedAllocation ? 'the saved weekday values' : 'the same target on every day'}. Your chosen daily average is {kcal.format(average)} kcal; seven days total {kcal.format(average * weekdays.length)} kcal. Changing a weekday never changes another day or the overall target. To change the average, calculate a fresh preview and explicitly replace the active plan.</p>
      {savedAllocation && <p className="mt-2 text-sm text-text-secondary">The service reviews the active saved snapshot from version {savedAllocation.version} without recalculating its historical estimate. A replacement keeps its unchanged accepted preview; no new measurements or calculator inputs are required.</p>}
      <form noValidate aria-label="Nutrition plan allocation" className="mt-6 space-y-6" onSubmit={submit}>
        <fieldset disabled={saving || staleSavedReview}>
          <legend className="font-semibold">Monday through Sunday (kcal/day)</legend>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {weekdays.map((weekday, index) => (
              <div key={weekday} className="min-w-0">
                <label className="block text-sm font-semibold" htmlFor={`${id}-${weekday}`}>{weekdayLabel(weekday)} (kcal)</label>
                <input
                  id={`${id}-${weekday}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={20000}
                  step={1}
                  required
                  className="mt-2 min-h-12 w-full rounded-lg border border-border-control bg-background px-3 py-2 text-text-primary aria-invalid:border-error"
                  value={values[index]}
                  onChange={(event) => changeDay(index, event.target.value)}
                  aria-invalid={!/^[1-9]\d*$/.test(values[index] ?? '') || Number(values[index]) > 20000 ? true : undefined}
                  aria-describedby={`${id}-balance`}
                />
              </div>
            ))}
          </div>
        </fieldset>
        <p id={`${id}-balance`} role="status" className={draft.remaining === 0 ? 'text-sm text-text-secondary' : 'text-sm text-warning'}>
          {draft.remaining === null
            ? 'Enter exactly seven whole-number targets from 1 to 20,000 kcal. No day is adjusted automatically.'
            : `Remaining allocation: ${difference.format(draft.remaining)} kcal. ${balanced ? 'The week is balanced.' : 'Adjust a weekday; no other day changes automatically.'}`}
        </p>
        {!balanced && <p className="text-sm text-text-secondary">A balanced seven-day allocation is required before the service can review each day's nutrient targets.</p>}
        {balanced && allocation.isFetching && <p role="status" className="text-sm text-text-secondary">Reviewing weekday targets with the nutrition service…</p>}
        {balanced && allocation.isError && <>
          <RequestFailure error={allocation.error} onRetry={staleSavedReview ? undefined : () => void allocation.refetch()} retrying={allocation.isFetching} heading={staleSavedReview ? 'Saved allocation review is stale' : 'Weekday review unavailable'} />
          {staleSavedReview && <>
            <p className="mt-3 text-sm text-text-secondary">This plan or revision is no longer current. Refresh the active plan and history, then review its weekday allocation again.</p>
            <button type="button" className="secondary-button mt-3" onClick={onRefreshActive}>Refresh saved plan</button>
          </>}
        </>}
        {reviewed && <>
          <p role="status" className="text-sm font-semibold text-info">Weekday allocation reviewed by the service. Nothing has been saved.</p>
          <WeekdayTargets title="Provisional weekday targets" days={reviewed.weekdays} average={reviewed.chosen_average_kcal} weeklyTotal={reviewed.weekly_total_kcal} notice={reviewed.notice} />
          {reviewed.risk_reasons.length > 0 && <div className="rounded-xl border border-border-control bg-background p-4" aria-label="Day-level review reasons">
            <h4 className="font-semibold">Review these day-level choices</h4>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-text-secondary">{reviewed.risk_reasons.map((reason) => <li key={reason.code}>{reason.label}</li>)}</ul>
            <p className="mt-3 text-sm text-text-secondary">These reasons and the review below do not establish individual safety or suitability.</p>
          </div>}
          {reviewed.acknowledgment_required && <label className="flex items-start gap-3 rounded-xl border border-border-control p-4 text-sm">
            <input type="checkbox" className="mt-1" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={saving} />
            I have reviewed the server's day-level reasons for this save or replacement. This acknowledgment is not a safety clearance.
          </label>}
        </>}
        <div>
          <label className="block text-sm font-semibold" htmlFor={`${id}-zone`}>Plan calendar time zone (IANA)</label>
          <input
            id={`${id}-zone`}
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={128}
            required
            value={timeZone}
            onChange={(event) => changeZone(event.target.value)}
            aria-invalid={!!zoneError}
            aria-describedby={`${id}-zone-help${zoneError ? ` ${id}-zone-error` : ''}`}
            disabled={saving || staleSavedReview}
            className="mt-2 min-h-12 w-full rounded-lg border border-border-control bg-background px-3 py-2 text-text-primary aria-invalid:border-error sm:max-w-md"
            placeholder="e.g. Europe/Oslo"
          />
          <p id={`${id}-zone-help`} className="mt-2 text-sm text-text-secondary">{suggestedZone ? `Browser suggestion: ${suggestedZone}. ` : 'Your browser did not supply a time zone. Enter one before saving. '}Confirm or correct the zone for your repeating local weekdays. {savedAllocation && `This saved version uses ${savedAllocation.time_zone}.`}</p>
          {zoneError && <p id={`${id}-zone-error`} className="mt-2 text-sm text-error">{zoneError}</p>}
        </div>
        {activeState === null && <p role="status" className="text-sm text-warning">{savedAllocation ? 'The active saved plan and revision must load before reviewing or replacing its weekday allocation. This review requires plan storage.' : 'Saved-plan status and revision must load before saving. The weekday review above does not need plan storage.'}</p>}
        {!savedVersionCurrent && <>
          <p role="alert" className="text-sm text-error">This saved plan is no longer active. Refresh it and review the current version before replacing anything.</p>
          <button type="button" className="secondary-button" onClick={onRefreshActive}>Refresh saved plan</button>
        </>}
        {submitError && <p role="alert" className="text-sm text-error">{submitError}</p>}
        {requestError && <>
          <RequestFailure error={requestError} heading="Plan was not saved" />
          {revisionConflict && <>
            <p className="mt-3 text-sm text-text-secondary">Refresh the saved-plan revision before trying again. If the accepted calculation has changed, run a fresh calculator preview.</p>
            <button type="button" className="secondary-button mt-3" onClick={onRefreshActive}>Refresh saved plan</button>
          </>}
        </>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="log-button" disabled={!canSave}>{saving ? 'Saving plan…' : replacing ? 'Replace active plan' : 'Save new plan'}</button>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Leave without saving</button>
        </div>
        <p className="text-sm text-text-secondary">Saving creates an immutable plan version only after the service confirms it. It does not record food consumed. Changing calculator inputs discards unfinished weekday edits.</p>
      </form>
    </section>
  )
}
