import { useId, useState, type FormEvent } from 'react'
import { weekdays, type ActivePlanResponse, type SavedPlan, type SavePlanRequest } from '@/entities/nutrition-plan'
import type { PreviewResponse } from '@/entities/nutrition-preview'
import { NutritionRequestError } from '../api/nutrition-request'
import { usePlanAllocationPreview, useReplaceNutritionPlan, useSaveNutritionPlan } from '../api/nutrition-plans'
import { proteinReviewWarning } from '../protein-review'
import { weekdayLabel } from '../weekday-label'
import { RequestFailure } from './nutrition-request-failure'
import { WeekdayTargets } from './nutrition-weekdays'
import { LiveMessage } from './live-message'

export type AllocationStep = 'weekdays' | 'review'

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

export function NutritionPlanEditor({ acceptedPreview, activeState, savedAllocation, step, onBack, onReview, onSaved, onCancel, onRefreshActive }: {
  acceptedPreview: PreviewResponse
  activeState: ActivePlanResponse | null
  savedAllocation?: SavedPlan
  step: AllocationStep
  onBack: () => void
  onReview: () => void
  onSaved: (plan: SavedPlan) => void
  onCancel?: () => void
  onRefreshActive: () => Promise<boolean> | void
}) {
  const id = useId()
  const average = acceptedPreview.daily_target.kcal
  const suggestedZone = browserTimeZone()
  const [values, setValues] = useState(() => savedAllocation
    ? savedAllocation.weekdays.map((day) => String(day.target.kcal))
    : weekdays.map(() => String(average)))
  const [editRevision, setEditRevision] = useState(0)
  const [timeZone, setTimeZone] = useState(() => savedAllocation?.time_zone ?? suggestedZone)
  const [zoneConfirmed, setZoneConfirmed] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [reviewedRevision, setReviewedRevision] = useState<number | null | undefined>()
  const [submitError, setSubmitError] = useState('')
  const [revisionConflict, setRevisionConflict] = useState<NutritionRequestError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
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
  const staleNewReview = !savedAllocation && allocation.isError && allocation.error instanceof NutritionRequestError &&
    allocation.error.kind === 'conflict'
  const zoneError = !timeZone.trim() ? 'Enter an IANA time zone to save a plan.' : timeZone.length > 128 ? 'The time zone must be at most 128 characters.' : !isValidTimeZone(timeZone.trim()) ? 'Enter a valid IANA time zone.' : ''
  const saving = save.isPending || replace.isPending
  const requestError = revisionConflict ?? operation.error
  const savedVersionCurrent = !savedAllocation || activeState === null || savedAllocationCurrent
  const canReview = reviewed !== null && savedVersionCurrent && !staleSavedReview && !revisionConflict && !saving
  const statusChanged = reviewedRevision !== undefined && activeState !== null && reviewedRevision !== activeState.revision
  const canSave = step === 'review' && activeState !== null && reviewed !== null && canReview && !statusChanged && !zoneError &&
    zoneConfirmed && (!reviewed.acknowledgment_required || acknowledged)
  const proteinWarning = proteinReviewWarning(acceptedPreview.inputs.weight_kg, acceptedPreview.inputs.strategy.protein)

  async function refreshActive() {
    setRefreshing(true)
    try {
      const recovered = await onRefreshActive()
      if (recovered && !savedAllocation) {
        setRevisionConflict(null)
        save.reset()
        replace.reset()
        setReviewedRevision(undefined)
        setAcknowledged(false)
        setZoneConfirmed(false)
        setSubmitError('')
        setEditRevision((current) => current + 1)
      }
    } finally {
      setRefreshing(false)
    }
  }

  function changeDay(index: number, value: string) {
    setValues((current) => current.map((day, currentIndex) => currentIndex === index ? value : day))
    setEditRevision((current) => current + 1)
    setAcknowledged(false)
    setZoneConfirmed(false)
    setSubmitError('')
    operation.reset()
  }

  function changeZone(value: string) {
    setTimeZone(value)
    setZoneConfirmed(false)
    setAcknowledged(false)
    setSubmitError('')
    operation.reset()
  }

  function proceedToReview() {
    if (!canReview) {
      setSubmitError('Balance all seven weekdays and wait for a current server review before continuing.')
      return
    }
    if (reviewedRevision !== (activeState?.revision ?? null)) {
      setZoneConfirmed(false)
      setAcknowledged(false)
    }
    setReviewedRevision(activeState?.revision ?? null)
    setSubmitError('')
    onReview()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (step === 'weekdays') {
      proceedToReview()
      return
    }
    if (!canSave || !draft.kcals || !reviewed || !activeState) {
      setSubmitError('Review a balanced server allocation, confirm the IANA calendar zone and load the current saved-plan revision before saving.')
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
      onSuccess: (response) => {
        if (response.plan) onSaved(response.plan)
        else setSubmitError('The save response contained no plan. Refresh saved plans before continuing.')
      },
      onError: (error) => {
        if (error instanceof NutritionRequestError && error.kind === 'conflict') setRevisionConflict(error)
      },
    })
  }

  return (
    <section className="min-w-0 rounded-2xl border border-border-subtle bg-surface p-5 sm:p-8" aria-labelledby={`${id}-title`}>
      <h3 className="text-xl font-semibold" id={`${id}-title`}>{step === 'weekdays' ? savedAllocation ? 'Edit saved weekdays' : 'Set weekday targets' : savedAllocation ? 'Review saved weekday replacement' : replacing ? 'Review a replacement plan' : 'Review a new plan'}</h3>
      <p className="mt-2 text-sm text-text-secondary">Chosen daily average {kcal.format(average)} kcal · planned weekly total {kcal.format(average * weekdays.length)} kcal. Changing a weekday never changes another day or the overall target.</p>
      {savedAllocation && <p className="mt-2 text-sm text-text-secondary">Editing version {savedAllocation.version} uses its unchanged accepted snapshot and saved calendar zone. The service reviews its active ID and revision; no new calculation is made.</p>}
      <form noValidate aria-label="Nutrition plan allocation" className="mt-6 space-y-5" onSubmit={submit}>
        {step === 'weekdays' && <>
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
          {!balanced && <p className="text-sm text-text-secondary">A balanced seven-day allocation is required before the service can review each day's nutrients.</p>}
          {balanced && allocation.isFetching && <p role="status" className="text-sm text-text-secondary">Reviewing weekday targets with the nutrition service…</p>}
          {balanced && allocation.isError && <RequestFailure error={allocation.error} onRetry={staleSavedReview || staleNewReview ? undefined : () => void allocation.refetch()} retrying={allocation.isFetching} heading={staleSavedReview ? 'Saved allocation review is stale' : staleNewReview ? 'Calculation preview is stale' : 'Weekday review unavailable'} />}
          {staleNewReview && <p className="text-sm text-text-secondary">This accepted calculation is stale. Return to Inputs and request a new calculator preview before reviewing weekday targets again.</p>}
          {reviewed && <p role="status" className="text-sm font-semibold text-info">Weekday allocation reviewed by the service. Continue to see all planned day targets and any review reasons before saving.</p>}
        </>}
        {step === 'review' && <>
          {reviewed ? <>
            <p className="text-sm font-semibold text-info">Server-reviewed provisional targets. Nothing has been saved.</p>
            <WeekdayTargets title="Provisional weekday targets" days={reviewed.weekdays} average={reviewed.chosen_average_kcal} weeklyTotal={reviewed.weekly_total_kcal} notice={reviewed.notice} />
            <LiveMessage className="block rounded-lg border border-warning p-3 text-sm text-warning" message={proteinWarning ? `Protein review: ${proteinWarning}` : null} />
            {reviewed.risk_reasons.length > 0 && <div className="rounded-xl border border-border-control bg-background p-4" aria-label="Day-level review reasons">
              <h4 className="font-semibold">Review these day-level choices</h4>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-text-secondary">{reviewed.risk_reasons.map((reason) => <li key={reason.code}>{reason.label}</li>)}</ul>
              <p className="mt-3 text-sm text-text-secondary">These reasons and the review below do not establish individual safety or suitability.</p>
            </div>}
            {reviewed.acknowledgment_required && <label className="flex min-h-11 items-center gap-3 rounded-xl border border-border-control p-4 text-sm">
              <input type="checkbox" className="h-5 w-5 shrink-0" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={saving || statusChanged} />
              I have reviewed the server's day-level reasons for this save or replacement. This acknowledgment is not a safety clearance.
            </label>}
          </> : <>
            <p role="alert" className="text-sm text-error">This weekday review is no longer current. Return to Weekday targets and request a fresh server review.</p>
            {balanced && allocation.isError && <RequestFailure error={allocation.error} heading={staleSavedReview ? 'Saved allocation review is stale' : staleNewReview ? 'Calculation preview is stale' : 'Weekday review unavailable'} />}
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
            <p id={`${id}-zone-help`} className="mt-2 text-sm text-text-secondary">{savedAllocation ? `Saved version zone: ${savedAllocation.time_zone}. ` : ''}{suggestedZone ? `Browser suggestion: ${suggestedZone}. ` : 'Your browser did not supply a zone. '}Confirm or correct the zone for your repeating local weekdays. No zone is assumed if this field is empty.</p>
            {zoneError && <p id={`${id}-zone-error`} className="mt-2 text-sm text-error">{zoneError}</p>}
          </div>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-border-control p-4 text-sm">
            <input type="checkbox" className="h-5 w-5 shrink-0" checked={zoneConfirmed} onChange={(event) => setZoneConfirmed(event.target.checked)} disabled={!!zoneError || saving || staleSavedReview || statusChanged} />
            I confirm this IANA calendar time zone for the repeating weekday plan.
          </label>
          {statusChanged && <p role="alert" className="text-sm text-error">Saved-plan status changed since this review. Return to Weekday targets, confirm the current plan and review again before saving.</p>}
        </>}
        {activeState === null && <p role="status" className="text-sm text-warning">{savedAllocation ? 'The active saved plan and revision must load before reviewing or replacing its weekday allocation. This review requires plan storage.' : 'Saved-plan status and revision must load before saving. A new weekday review does not need plan storage.'}</p>}
        {!savedVersionCurrent && <p role="alert" className="text-sm text-error">This saved plan is no longer active. Refresh it and review the current version before replacing anything.</p>}
        {(staleSavedReview || !savedVersionCurrent || revisionConflict) && <button type="button" className="secondary-button" onClick={() => void refreshActive()} disabled={refreshing || saving}>Refresh saved plan</button>}
        {submitError && <p role="alert" className="text-sm text-error">{submitError}</p>}
        {requestError && <RequestFailure error={requestError} heading="Plan was not saved" />}
        <div className="flex flex-wrap gap-3">
          {step === 'review'
            ? <button type="submit" className="log-button" disabled={!canSave}>{saving ? 'Saving plan…' : replacing ? 'Replace active plan' : 'Save new plan'}</button>
            : <button type="button" className="log-button" disabled={!canReview} onClick={proceedToReview}>Next: Review and save</button>}
          <button type="button" className="secondary-button" onClick={onBack} disabled={saving}>{step === 'review' ? 'Back to weekdays' : savedAllocation ? 'Back to active plan' : 'Back to preview'}</button>
          {onCancel && step === 'review' && <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Leave without saving</button>}
        </div>
        {step === 'review' && <p className="text-sm text-text-secondary">Saving creates an immutable version only after the service confirms it. These are planned targets, not recorded food consumption.</p>}
      </form>
    </section>
  )
}
