import { useState } from 'react'
import type { SavedPlan } from '@/entities/nutrition-plan'
import type { PreviewResponse } from '@/entities/nutrition-preview'
import { NutritionRequestError } from '../api/nutrition-request'
import { useActiveNutritionPlan, useEndNutritionPlan, useNutritionPlanHistory } from '../api/nutrition-plans'
import { NutritionPlanEditor } from './nutrition-plan-editor'
import { RequestFailure } from './nutrition-request-failure'
import { WeekdayTargets } from './nutrition-weekdays'

export type PlanEditorMode = 'new' | 'edit-active' | null

const kcal = new Intl.NumberFormat('en-GB')
const utc = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
function atUtc(value: string) {
  return `${utc.format(new Date(value))} UTC`
}

export function NutritionPlans({ acceptedPreview, previewRevision, mode, onModeChange, onConfirmedSave }: {
  acceptedPreview: PreviewResponse | null
  previewRevision: number
  mode: PlanEditorMode
  onModeChange: (mode: PlanEditorMode) => void
  onConfirmedSave: () => void
}) {
  const active = useActiveNutritionPlan()
  const history = useNutritionPlanHistory()
  const end = useEndNutritionPlan()
  const [selectedSavedPlan, setSelectedSavedPlan] = useState<SavedPlan | null>(null)
  const [message, setMessage] = useState('')
  const activeState = active.isSuccess && !active.isFetching ? active.data : null
  const historyPages = history.isSuccess || history.isFetchNextPageError ? history.data?.pages : null
  const savedPlans = historyPages?.flatMap((page) => page.plans)

  function refreshSavedPlans() {
    onModeChange(null)
    setSelectedSavedPlan(null)
    void active.refetch()
    void history.refetch()
  }

  function endActivePlan() {
    if (!activeState?.plan || !window.confirm(`End nutrition plan version ${activeState.plan.version}? It will leave the active plan and remain in saved history.`)) return
    setMessage('')
    end.reset()
    end.mutate(activeState.revision, { onSuccess: () => {
      setMessage('Nutrition plan ended. Its saved history remains available.')
      onModeChange(null)
      setSelectedSavedPlan(null)
    } })
  }

  const editingSavedPlan = mode === 'edit-active' ? selectedSavedPlan : null
  const editorPreview = editingSavedPlan?.accepted_preview ?? (mode === 'new' ? acceptedPreview : null)

  return (
    <section className="mt-10 space-y-7" aria-labelledby="nutrition-plans-title">
      <div>
        <h2 id="nutrition-plans-title" className="text-2xl font-semibold">Nutrition plans</h2>
        <p className="mt-2 text-sm text-text-secondary">A reviewed allocation is still provisional until a write succeeds. Saved plans are planned targets, not logged food intake; changes do not recalculate them automatically.</p>
      </div>
      {editorPreview && <NutritionPlanEditor
        key={editingSavedPlan ? `saved-${editingSavedPlan.id}-${editingSavedPlan.version}` : `preview-${previewRevision}`}
        acceptedPreview={editorPreview}
        savedAllocation={editingSavedPlan ?? undefined}
        activeState={activeState}
        onSaved={(plan) => {
          setMessage(`Nutrition plan version ${plan.version} saved. The previous active version remains in history.`)
          setSelectedSavedPlan(null)
          onConfirmedSave()
        }}
        onCancel={() => { onModeChange(null); setSelectedSavedPlan(null) }}
        onRefreshActive={refreshSavedPlans}
      />}
      {acceptedPreview && mode === null && <button className="secondary-button" type="button" onClick={() => { onModeChange('new'); setMessage('') }}>Review this calculation for a plan</button>}
      <p role="status" className="text-sm text-success">{message}</p>

      <section className="rounded-2xl border border-border-subtle bg-surface p-5 sm:p-8" aria-labelledby="saved-active-title">
        <h3 id="saved-active-title" className="text-xl font-semibold">Saved active plan</h3>
        {active.isFetching && <p role="status" className="mt-3 text-sm text-text-secondary">Loading saved plan and revision…</p>}
        {active.isError && <RequestFailure error={active.error} heading="Saved plan unavailable" onRetry={() => void active.refetch()} retrying={active.isFetching} />}
        {activeState && !activeState.plan && <p className="mt-3 text-sm text-text-secondary">No active nutrition plan. An unsaved calculator preview is not a plan.</p>}
        {activeState?.plan && <>
          <p className="mt-3 text-sm text-text-secondary">Version {activeState.plan.version} · Started {atUtc(activeState.plan.started_at)} · Calendar zone: {activeState.plan.time_zone}. Daily average {kcal.format(activeState.plan.chosen_average_kcal)} kcal. This saved snapshot is not consumed intake.</p>
          <p className="mt-2 text-sm text-text-secondary">Accepted method: {activeState.plan.accepted_preview.method}. Day-level review acknowledged: {activeState.plan.day_allocation_risk_acknowledged ? 'Yes (review only, not safety clearance)' : 'No acknowledgment required for this saved version'}.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="secondary-button" type="button" disabled={end.isPending || mode !== null} onClick={() => {
              setSelectedSavedPlan(activeState.plan)
              setMessage('')
              onModeChange('edit-active')
            }}>Edit saved weekday allocation</button>
            <button className="secondary-button delete-button" type="button" disabled={end.isPending || mode !== null} onClick={endActivePlan}>{end.isPending ? 'Ending plan…' : 'End active plan'}</button>
          </div>
          <WeekdayTargets title="Saved weekday targets" days={activeState.plan.weekdays} average={activeState.plan.chosen_average_kcal} weeklyTotal={activeState.plan.weekly_total_kcal} notice={activeState.plan.notice} />
        </>}
        {end.error && <>
          <RequestFailure error={end.error} heading="Plan was not ended" />
          {end.error instanceof NutritionRequestError && end.error.kind === 'conflict' && <button className="secondary-button mt-3" type="button" onClick={refreshSavedPlans}>Refresh saved plan</button>}
        </>}
      </section>

      <section className="rounded-2xl border border-border-subtle bg-surface p-5 sm:p-8" aria-labelledby="plan-history-title">
        <h3 id="plan-history-title" className="text-xl font-semibold">Saved plan history</h3>
        {history.isFetching && !history.isFetchingNextPage && <p role="status" className="mt-3 text-sm text-text-secondary">Loading saved plan history…</p>}
        {history.isError && !history.isFetchNextPageError && <RequestFailure error={history.error} heading="Saved history unavailable" onRetry={() => void history.refetch()} retrying={history.isFetching} />}
        {savedPlans && !history.isFetching && savedPlans.length === 0 && <p className="mt-3 text-sm text-text-secondary">No saved plan versions yet.</p>}
        {savedPlans && (history.isFetchNextPageError || !history.isFetching || history.isFetchingNextPage) && savedPlans.length > 0 && <ol className="mt-4 space-y-3">
          {savedPlans.map((plan) => <li key={plan.id} className="min-w-0 rounded-xl border border-border-subtle bg-background p-4">
            <p className="font-semibold">Version {plan.version} · {plan.ended_at === null ? 'Active' : 'Ended'}</p>
            <p className="mt-1 text-sm text-text-secondary">Started {atUtc(plan.started_at)}{plan.ended_at && ` · Ended ${atUtc(plan.ended_at)}`}. Zone: {plan.time_zone}. Chosen average: {kcal.format(plan.chosen_average_kcal)} kcal/day.</p>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-info">View saved version {plan.version} weekday targets</summary>
              <WeekdayTargets title={`Version ${plan.version} saved targets`} days={plan.weekdays} average={plan.chosen_average_kcal} weeklyTotal={plan.weekly_total_kcal} notice={plan.notice} />
            </details>
          </li>)}
        </ol>}
        {history.isFetchNextPageError && <RequestFailure error={history.error} heading="More saved history unavailable" onRetry={() => void history.fetchNextPage()} retrying={history.isFetchingNextPage} />}
        {history.hasNextPage && !history.isError && <button className="secondary-button mt-4" type="button" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? 'Loading more…' : 'Load more saved versions'}</button>}
      </section>
    </section>
  )
}
