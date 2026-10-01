import { useId, useState } from 'react'
import type { SavedPlan } from '@/entities/nutrition-plan'
import { NutritionRequestError } from '../api/nutrition-request'
import { useEndNutritionPlan, type useActiveNutritionPlan, type useNutritionPlanHistory } from '../api/nutrition-plans'
import { NutritionPlanEditor, type AllocationStep } from './nutrition-plan-editor'
import { RequestFailure } from './nutrition-request-failure'
import { NutritionResult } from './nutrition-result'
import { WeekdayTargets } from './nutrition-weekdays'
import { LiveMessage } from './live-message'

type ActiveQuery = ReturnType<typeof useActiveNutritionPlan>
type HistoryQuery = ReturnType<typeof useNutritionPlanHistory>

const kcal = new Intl.NumberFormat('en-GB')
const grams = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })
const utc = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })

function atUtc(value: string) {
  return `${utc.format(new Date(value))} UTC`
}

export function NutritionActivePlan({ active, history, notice, showFailure, onMessageChange, onNewCalculation }: {
  active: ActiveQuery
  history: HistoryQuery
  notice: string
  showFailure: boolean
  onMessageChange: (message: string) => void
  onNewCalculation: () => void
}) {
  const end = useEndNutritionPlan()
  const endHintId = useId()
  const [selectedSavedPlan, setSelectedSavedPlan] = useState<SavedPlan | null>(null)
  const [step, setStep] = useState<AllocationStep>('weekdays')
  // Cached data keeps the last known plan visible through a refresh or a failed refresh, while the confirmed
  // state stays the only authority for writes and for claiming that no plan exists.
  const cachedState = active.data ?? null
  const confirmedState = active.isSuccess ? active.data : null

  function refreshSavedPlans() {
    setSelectedSavedPlan(null)
    setStep('weekdays')
    void active.refetch()
    void history.refetch()
  }

  function endActivePlan() {
    if (!confirmedState?.plan || !window.confirm(`End nutrition plan version ${confirmedState.plan.version}? It will leave the active plan and remain in saved history.`)) return
    onMessageChange('')
    end.reset()
    end.mutate(confirmedState.revision, { onSuccess: () => {
      onMessageChange('Nutrition plan ended. Its saved history remains available.')
      setSelectedSavedPlan(null)
    } })
  }

  const plan = cachedState?.plan
  const target = plan?.accepted_preview.daily_target
  // Ending needs a confirmed revision, so the action is unavailable while only cached content is on screen.
  const canEnd = Boolean(confirmedState?.plan)

  return (
    <section className="min-w-0 rounded-2xl border border-border-subtle bg-surface p-5 sm:p-8" aria-labelledby="saved-active-title">
      <h2 id="saved-active-title" className="text-xl font-semibold">Active plan</h2>
      <p className="mt-2 text-sm text-text-secondary">Saved targets are planned choices, not food intake or measured expenditure.</p>
      <LiveMessage className="mt-3 block text-sm text-success" message={notice} />
      {active.isFetching && <p role="status" className="mt-3 text-sm text-text-secondary">Loading saved plan and revision…</p>}
      {active.isError && showFailure && <RequestFailure error={active.error} heading="Saved plan unavailable" onRetry={() => void active.refetch()} retrying={active.isFetching} />}
      {confirmedState && !confirmedState.plan && !selectedSavedPlan && <>
        <p className="mt-4 text-sm text-text-secondary">No active nutrition plan. An unsaved calculator preview is not a plan.</p>
        <button className="secondary-button mt-4" type="button" onClick={onNewCalculation}>New calculation</button>
      </>}
      {selectedSavedPlan && <div className="mt-6">
        <NutritionPlanEditor
          key={`saved-${selectedSavedPlan.id}-${selectedSavedPlan.version}`}
          acceptedPreview={selectedSavedPlan.accepted_preview}
          savedAllocation={selectedSavedPlan}
          activeState={confirmedState}
          step={step}
          onBack={() => step === 'review' ? setStep('weekdays') : setSelectedSavedPlan(null)}
          onReview={() => setStep('review')}
          onSaved={(saved) => {
            onMessageChange(`Nutrition plan version ${saved.version} saved. The previous active version remains in history.`)
            setSelectedSavedPlan(null)
            setStep('weekdays')
          }}
          onCancel={() => setSelectedSavedPlan(null)}
          onRefreshActive={refreshSavedPlans}
        />
      </div>}
      {plan && target && !selectedSavedPlan && <>
        <p className="mt-4 text-sm text-text-secondary">Version {plan.version} · Started {atUtc(plan.started_at)} · Calendar zone: {plan.time_zone}.</p>
        <dl className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ['Chosen daily target', `${kcal.format(plan.chosen_average_kcal)} kcal`],
            ['Protein target', `${grams.format(target.protein_g)} g`],
            ['Fat target', `${grams.format(target.fat_g)} g`],
            ['Carbohydrate target', `${grams.format(target.carbohydrate_g)} g`],
            ['Fibre target', `${grams.format(target.fibre_g)} g`],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-lg border border-border-subtle bg-background p-3">
              <dt className="text-xs text-text-secondary">{label}</dt>
              <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <WeekdayTargets title="Saved weekday targets" headingLevel={3} days={plan.weekdays} average={plan.chosen_average_kcal} weeklyTotal={plan.weekly_total_kcal} notice={plan.notice} />
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="secondary-button" type="button" disabled={end.isPending} onClick={() => {
            setSelectedSavedPlan(plan)
            setStep('weekdays')
            onMessageChange('')
          }}>Edit weekdays</button>
          <button className="secondary-button" type="button" disabled={end.isPending} onClick={onNewCalculation}>New calculation</button>
          <button className="secondary-button delete-button" type="button" disabled={end.isPending || !canEnd} aria-describedby={canEnd ? undefined : endHintId} onClick={endActivePlan}>{end.isPending ? 'Ending plan…' : 'End plan'}</button>
        </div>
        {!canEnd && <p id={endHintId} className="mt-2 text-sm text-text-secondary">Ending this plan needs a confirmed active revision. Retry the saved-plan request first; the version shown here is the last known one.</p>}
        <details className="mt-4 text-sm text-text-secondary">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-info">About this saved calculation</summary>
          <p className="mt-2">Day-level review acknowledged: {plan.day_allocation_risk_acknowledged ? 'Yes (review only, not safety clearance)' : 'No acknowledgment required for this saved version'}.</p>
          <NutritionResult result={plan.accepted_preview} saved />
        </details>
      </>}
      {end.error && <>
        <RequestFailure error={end.error} heading="Plan was not ended" />
        {end.error instanceof NutritionRequestError && end.error.kind === 'conflict' && <button className="secondary-button mt-3" type="button" onClick={refreshSavedPlans}>Refresh saved plan</button>}
      </>}
    </section>
  )
}

export function NutritionHistory({ history }: { history: HistoryQuery }) {
  // Cached pages stay rendered through a refresh so open version disclosures are not collapsed by a refetch.
  const savedPlans = history.data?.pages.flatMap((page) => page.plans) ?? null

  return (
    <section className="min-w-0 rounded-2xl border border-border-subtle bg-surface p-5 sm:p-8" aria-labelledby="plan-history-title">
      <h2 id="plan-history-title" className="text-xl font-semibold">Saved plan history</h2>
      <p className="mt-2 text-sm text-text-secondary">Past versions are immutable planned targets, not logged intake.</p>
      {history.isFetching && !history.isFetchingNextPage && <p role="status" className="mt-3 text-sm text-text-secondary">Loading saved plan history…</p>}
      {history.isError && !history.isFetchNextPageError && <RequestFailure error={history.error} heading="Saved history unavailable" onRetry={() => void history.refetch()} retrying={history.isFetching} />}
      {history.isSuccess && !history.isFetching && savedPlans?.length === 0 && <p className="mt-3 text-sm text-text-secondary">No saved plan versions yet.</p>}
      {savedPlans && savedPlans.length > 0 && <ol className="mt-4 space-y-3">
        {savedPlans.map((plan) => <li key={plan.id} className="min-w-0 rounded-xl border border-border-subtle bg-background p-4">
          <p className="font-semibold">Version {plan.version} · {plan.ended_at === null ? 'Active' : 'Ended'}</p>
          <p className="mt-1 text-sm text-text-secondary">Started {atUtc(plan.started_at)}{plan.ended_at && ` · Ended ${atUtc(plan.ended_at)}`} · Zone: {plan.time_zone} · Chosen average: {kcal.format(plan.chosen_average_kcal)} kcal/day.</p>
          <details className="mt-3">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-info">View saved version {plan.version} details</summary>
            <WeekdayTargets title={`Version ${plan.version} saved targets`} headingLevel={3} days={plan.weekdays} average={plan.chosen_average_kcal} weeklyTotal={plan.weekly_total_kcal} notice={plan.notice} />
            <NutritionResult result={plan.accepted_preview} saved />
          </details>
        </li>)}
      </ol>}
      {history.isFetchNextPageError && <RequestFailure error={history.error} heading="More saved history unavailable" onRetry={() => void history.fetchNextPage()} retrying={history.isFetchingNextPage} />}
      {history.hasNextPage && !history.isError && <button className="secondary-button mt-4" type="button" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? 'Loading more…' : 'Load more saved versions'}</button>}
    </section>
  )
}
