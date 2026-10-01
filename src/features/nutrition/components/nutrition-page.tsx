import { useAuth } from '@clerk/react'
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { MethodOption, PreviewMethod, PreviewOptions, PreviewResponse, StartingSuggestion } from '@/entities/nutrition-preview'
import { useNutritionOptions, useNutritionPreview } from '../api/nutrition-estimates'
import { useActiveNutritionPlan, useNutritionPlanHistory } from '../api/nutrition-plans'
import { NutritionRequestError } from '../api/nutrition-request'
import { initialValues, validatePreview, type FormErrors, type PreviewFormValues } from '../preview-form'
import { proteinLimits, proteinReviewWarning, stepProteinPerKg } from '../protein-review'
import { NutritionPlanEditor } from './nutrition-plan-editor'
import { NutritionActivePlan, NutritionHistory } from './nutrition-plans'
import { RequestFailure } from './nutrition-request-failure'
import { NutritionResult } from './nutrition-result'
import { LiveMessage } from './live-message'
import './nutrition-fields.css'

type NutritionTab = 'active' | 'calculator' | 'history'
type CalculatorStep = 'inputs' | 'preview' | 'weekdays' | 'review'

const tabs: { id: NutritionTab; label: string }[] = [
  { id: 'active', label: 'Active plan' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'history', label: 'History' },
]
const steps: { id: CalculatorStep; label: string }[] = [
  { id: 'inputs', label: 'Inputs' },
  { id: 'preview', label: 'Preview' },
  { id: 'weekdays', label: 'Weekday targets' },
  { id: 'review', label: 'Review and save' },
]
const methodLabels: Record<PreviewMethod, string> = {
  nasem_2023_adult_tee: 'Calculate adult energy estimates',
  manual_target_v1: 'Enter a manual base target',
}
const formulaLabels = { male: 'Male equation', female: 'Female equation' } as const
const activityLabels = { inactive: 'Inactive', low_active: 'Low active', active: 'Active', very_active: 'Very active' } as const
const inputClass = 'min-h-12 w-full min-w-0 rounded-lg border border-border-control bg-background px-3 py-2 text-text-primary aria-invalid:border-error'

function isPreviewOption(option: MethodOption): option is MethodOption & { id: PreviewMethod } {
  return option.id === 'nasem_2023_adult_tee' || option.id === 'manual_target_v1'
}

function SuggestionSource({ label, suggestion, display }: { label: string; suggestion: StartingSuggestion<string>; display: string }) {
  return (
    <div className="text-sm text-text-secondary">
      <p>Editable starting suggestion: <strong className="text-text-primary">{display}</strong>.</p>
      <details className="mt-1">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-info">Source and scope for {label}</summary>
        <p className="mt-2">{suggestion.scope}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {suggestion.sources.map((source) => (
            <li key={source.id}>
              <a className="inline-flex min-h-11 items-center break-words text-info underline underline-offset-2" href={source.url}>{source.id}</a>: {source.scope}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

function NumberField({ id, name, label, value, onChange, min, max, step = 'any', error, help, warning, onStep }: {
  id: string
  name: keyof PreviewFormValues
  label: string
  value: string
  onChange: (value: string) => void
  min: number
  max: number
  step?: string
  error?: string
  help?: ReactNode
  warning?: string | null
  onStep?: (direction: -1 | 1) => void
}) {
  const helpId = help ? `${id}-help` : undefined
  const warningId = warning ? `${id}-warning` : undefined
  const errorId = error ? `${id}-error` : undefined
  const stepHintId = onStep ? `${id}-step-hint` : undefined
  return (
    <div className="min-w-0 space-y-2">
      <label className="block text-sm font-semibold" htmlFor={id}>{label}</label>
      <div className="flex min-w-0 gap-2">
        <input
          id={id}
          name={name}
          className={onStep ? `${inputClass} stepped-number` : inputClass}
          type="number"
          inputMode={step === '1' ? 'numeric' : 'decimal'}
          min={min}
          max={max}
          step={step}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onStep ? (event) => {
            // A step of "any" leaves the browser's own stepping inert, so the arrow keys are routed through the
            // same exact-tenth helper as the visible controls instead of a silent or drifting native step.
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            onStep(event.key === 'ArrowUp' ? 1 : -1)
          } : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={[stepHintId, helpId, warningId, errorId].filter(Boolean).join(' ') || undefined}
        />
        {onStep && <div className="flex shrink-0 gap-1">
          <button type="button" className="secondary-button min-w-11 px-2" aria-label="Decrease protein by 0.1 g/kg/day" disabled={stepProteinPerKg(value, -1) === null} onClick={() => onStep(-1)}>-</button>
          <button type="button" className="secondary-button min-w-11 px-2" aria-label="Increase protein by 0.1 g/kg/day" disabled={stepProteinPerKg(value, 1) === null} onClick={() => onStep(1)}>+</button>
        </div>}
      </div>
      {onStep && <p className="text-sm text-text-secondary" id={stepHintId}>Use the - and + controls, or the up and down arrow keys in this field, to change protein by exactly 0.1 g/kg/day.</p>}
      {help && <div id={helpId}>{help}</div>}
      <LiveMessage id={warningId} className="block rounded-lg border border-warning p-3 text-sm text-warning" message={warning ? `Protein review: ${warning}` : null} />
      {error && <p className="text-sm text-error" id={errorId}>{error}</p>}
    </div>
  )
}

function NutritionCalculator({ options, methods, onResultChange }: {
  options: PreviewOptions
  methods: (MethodOption & { id: PreviewMethod })[]
  onResultChange: (result: PreviewResponse | null) => void
}) {
  const id = useId()
  const [values, setValues] = useState(() => initialValues(options))
  const [errors, setErrors] = useState<FormErrors>({})
  const [failure, setFailure] = useState<Error | null>(null)
  const revision = useRef(0)
  const preview = useNutritionPreview()
  const rawProtein = values.proteinMode === 'per_kg' ? values.proteinPerKg : values.proteinDailyGrams
  const proteinWarning = values.weightKg.trim() && rawProtein.trim()
    ? proteinReviewWarning(Number(values.weightKg), values.proteinMode === 'per_kg'
      ? { mode: 'per_kg', g_per_kg: Number(rawProtein) }
      : { mode: 'daily_grams', g_per_day: Number(rawProtein) })
    : null

  function change<K extends keyof PreviewFormValues>(field: K, value: PreviewFormValues[K]) {
    revision.current += 1
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      const next = { ...current }
      delete next[field]
      if (field === 'method') {
        delete next.heightCm
        delete next.formula
        delete next.activity
        delete next.manualBaseKcal
      }
      if (field === 'proteinMode') {
        delete next.proteinPerKg
        delete next.proteinDailyGrams
      }
      return next
    })
    onResultChange(null)
    setFailure(null)
    preview.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const { request, errors: nextErrors } = validatePreview(values)
    const submittedRevision = ++revision.current
    setErrors(nextErrors)
    onResultChange(null)
    setFailure(null)
    preview.reset()
    if (!request) {
      const firstInvalid = Object.keys(nextErrors)[0]
      if (firstInvalid) event.currentTarget.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus()
      return
    }
    preview.mutate(request, {
      onSuccess: (response) => {
        if (revision.current === submittedRevision) onResultChange(response)
      },
      onError: (error) => {
        if (revision.current === submittedRevision) setFailure(error)
      },
    })
  }

  if (failure instanceof NutritionRequestError && (failure.kind === 'forbidden' || failure.kind === 'authentication')) {
    return <RequestFailure error={failure} />
  }

  const suggestions = options.starting_suggestions
  const methodErrorId = errors.method ? `${id}-method-error` : undefined
  const formulaErrorId = errors.formula ? `${id}-formula-error` : undefined
  const activityErrorId = errors.activity ? `${id}-activity-error` : undefined
  const calculated = values.method === 'nasem_2023_adult_tee'
  return (
    <section className="mt-6 rounded-2xl border border-border-subtle bg-surface p-5 sm:p-8" aria-labelledby={`${id}-form-title`}>
      <h3 className="text-xl font-semibold" id={`${id}-form-title`}>Calculate a preview</h3>
      <p className="mt-2 text-sm text-text-secondary">Enter your own measurements; the calculator never reads the Weight journal. Required inputs depend on the selected method.</p>
      <form className="mt-6 space-y-7" onSubmit={submit} noValidate aria-label="Nutrition preview">
        <fieldset>
          <legend className="text-lg font-semibold">Preview method</legend>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {methods.map((method) => (
              <div className={`min-w-0 rounded-xl border p-4 ${values.method === method.id ? 'border-primary bg-selected' : 'border-border-control'}`} key={method.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                  <input type="radio" name="method" value={method.id} checked={values.method === method.id} onChange={() => change('method', method.id)} aria-invalid={errors.method ? true : undefined} aria-describedby={methodErrorId} />
                  {methodLabels[method.id]}
                </label>
                <p className="mt-1 text-sm text-text-secondary">{method.id === 'manual_target_v1' ? 'Your chosen base target, not an expenditure estimate.' : 'Separate resting and estimated maintenance values.'}</p>
                <details className="mt-1 text-sm text-text-secondary">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-info">About {methodLabels[method.id]} (scope and source)</summary>
                  <p className="mt-2">{method.scope}</p>
                  {method.source_url && <a className="mt-2 inline-flex min-h-11 items-center break-words text-info underline underline-offset-2" href={method.source_url}>Method source: {method.source_id}</a>}
                </details>
              </div>
            ))}
          </div>
          {errors.method && <p className="mt-2 text-sm text-error" id={methodErrorId}>{errors.method}</p>}
        </fieldset>

        <fieldset>
          <legend className="text-lg font-semibold">Your inputs</legend>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <NumberField id={`${id}-age`} name="ageYears" label="Age (completed years)" value={values.ageYears} onChange={(value) => change('ageYears', value)} min={19} max={120} step="1" error={errors.ageYears} help={<p className="text-sm text-text-secondary">Adults age 19 and older; not an individual safety assessment.</p>} />
            <NumberField id={`${id}-weight`} name="weightKg" label="Manually entered weight (kg)" value={values.weightKg} onChange={(value) => change('weightKg', value)} min={proteinLimits.weightKg[0]} max={proteinLimits.weightKg[1]} error={errors.weightKg} />
            {calculated && <>
              <NumberField id={`${id}-height`} name="heightCm" label="Height (cm)" value={values.heightCm} onChange={(value) => change('heightCm', value)} min={100} max={250} error={errors.heightCm} />
              <div className="min-w-0 space-y-2">
                <label className="block text-sm font-semibold" htmlFor={`${id}-formula`}>Formula parameter</label>
                <select id={`${id}-formula`} name="formula" className={inputClass} required value={values.formula} onChange={(event) => change('formula', options.formula_parameters.find((formula) => formula === event.target.value) ?? '')} aria-invalid={errors.formula ? true : undefined} aria-describedby={formulaErrorId}>
                  <option value="">Choose a formula parameter</option>
                  {options.formula_parameters.map((formula) => <option key={formula} value={formula}>{formulaLabels[formula]}</option>)}
                </select>
                <p className="text-sm text-text-secondary">Select explicitly; not inferred from your account.</p>
                {errors.formula && <p className="text-sm text-error" id={formulaErrorId}>{errors.formula}</p>}
              </div>
              <div className="min-w-0 space-y-2 sm:col-span-2">
                <label className="block text-sm font-semibold" htmlFor={`${id}-activity`}>General activity category</label>
                <select id={`${id}-activity`} name="activity" className={inputClass} required value={values.activity} onChange={(event) => change('activity', options.activity_categories.find((activity) => activity.id === event.target.value)?.id ?? '')} aria-invalid={errors.activity ? true : undefined} aria-describedby={activityErrorId}>
                  <option value="">Choose an activity category</option>
                  {options.activity_categories.map((activity) => <option key={activity.id} value={activity.id}>{activityLabels[activity.id]}</option>)}
                </select>
                {errors.activity && <p className="text-sm text-error" id={activityErrorId}>{errors.activity}</p>}
                <details className="text-sm text-text-secondary">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-info">Activity category PAL ranges and source</summary>
                  <p className="mt-2">General ranges, not sport, step or workout presets.</p>
                  <ul className="mt-2 list-disc pl-5">{options.activity_categories.map((activity) => <li key={activity.id}>{activityLabels[activity.id]}: PAL {activity.pal_min_inclusive.toFixed(2)} to &lt;{activity.pal_max_exclusive.toFixed(2)}</li>)}</ul>
                  <a className="mt-2 inline-flex min-h-11 items-center break-words text-info underline underline-offset-2" href={options.activity_source_url}>Activity category source</a>
                </details>
              </div>
            </>}
            {values.method === 'manual_target_v1' && <NumberField id={`${id}-base`} name="manualBaseKcal" label="Manual base target (kcal/day)" value={values.manualBaseKcal} onChange={(value) => change('manualBaseKcal', value)} min={1} max={20000} step="1" error={errors.manualBaseKcal} help={<p className="text-sm text-text-secondary">Your chosen starting target, not estimated expenditure.</p>} />}
            <NumberField id={`${id}-adjustment`} name="adjustmentKcal" label="Chosen calorie adjustment (kcal/day)" value={values.adjustmentKcal} onChange={(value) => change('adjustmentKcal', value)} min={-20000} max={20000} step="1" error={errors.adjustmentKcal} help={<p className="text-sm text-text-secondary">Enter a signed amount or 0. No preset adjustment is assumed safe.</p>} />
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-lg font-semibold">Editable nutrient strategy</legend>
          <p className="mt-2 text-sm text-text-secondary">Starting suggestions are not measured needs. Choose your own values before previewing.</p>
          <div className="mt-4 space-y-5">
            <div>
              <span className="block text-sm font-semibold" id={`${id}-protein-mode-label`}>Protein target mode</span>
              <div className="mt-2 flex flex-wrap gap-5" role="group" aria-labelledby={`${id}-protein-mode-label`}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="radio" name="proteinMode" checked={values.proteinMode === 'per_kg'} onChange={() => change('proteinMode', 'per_kg')} />Per kg of entered weight</label>
                <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="radio" name="proteinMode" checked={values.proteinMode === 'daily_grams'} onChange={() => change('proteinMode', 'daily_grams')} />Fixed daily grams</label>
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {values.proteinMode === 'per_kg'
                ? <NumberField id={`${id}-protein-per-kg`} name="proteinPerKg" label="Protein (g/kg/day)" value={values.proteinPerKg} onChange={(value) => change('proteinPerKg', value)} min={proteinLimits.perKg[0]} max={proteinLimits.perKg[1]} error={errors.proteinPerKg} warning={proteinWarning} onStep={(direction) => {
                  const next = stepProteinPerKg(values.proteinPerKg, direction)
                  if (next !== null) change('proteinPerKg', next)
                }} help={<SuggestionSource label="protein" suggestion={suggestions.protein_g_per_kg} display={`${suggestions.protein_g_per_kg.value} ${suggestions.protein_g_per_kg.unit}`} />} />
                : <NumberField id={`${id}-protein-grams`} name="proteinDailyGrams" label="Protein (g/day)" value={values.proteinDailyGrams} onChange={(value) => change('proteinDailyGrams', value)} min={proteinLimits.dailyGrams[0]} max={proteinLimits.dailyGrams[1]} error={errors.proteinDailyGrams} warning={proteinWarning} help={<>
                  <p className="text-sm text-text-secondary">Compared with your manually entered weight for the product review cue. The per-kg suggestion does not set this value.</p>
                  <SuggestionSource label="protein" suggestion={suggestions.protein_g_per_kg} display={`${suggestions.protein_g_per_kg.value} ${suggestions.protein_g_per_kg.unit} (not applied in fixed mode)`} />
                </>} />}
              <NumberField id={`${id}-fat`} name="fatPercent" label="Fat share (% of daily calories)" value={values.fatPercent} onChange={(value) => change('fatPercent', value)} min={0} max={100} error={errors.fatPercent} help={<SuggestionSource label="fat" suggestion={suggestions.fat_share} display={`${suggestions.fat_share.value * 100}% (fraction ${suggestions.fat_share.value})`} />} />
              <NumberField id={`${id}-fibre`} name="fibreGrams" label="Fibre (g/day)" value={values.fibreGrams} onChange={(value) => change('fibreGrams', value)} min={0} max={100} error={errors.fibreGrams} help={<SuggestionSource label="fibre" suggestion={suggestions.fibre_g_per_day} display={`${suggestions.fibre_g_per_day.value} ${suggestions.fibre_g_per_day.unit}`} />} />
            </div>
          </div>
        </fieldset>

        {Object.keys(errors).length > 0 && <p className="text-sm text-error" role="alert">Check the indicated inputs and try again.</p>}
        <button type="submit" className="log-button" disabled={preview.isPending}>{preview.isPending ? 'Calculating…' : failure ? 'Retry preview' : 'Preview daily targets'}</button>
        <p className="text-sm text-text-secondary">Provisional targets, not food intake or medical advice. This action does not save a plan.</p>
        <details className="text-sm text-text-secondary">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-info">About this calculator</summary>
          <p className="mt-2">{options.notice}</p>
        </details>
      </form>
      {preview.isPending && <p className="mt-5 text-text-secondary" role="status">Calculating your provisional preview…</p>}
      {failure && <RequestFailure error={failure} />}
    </section>
  )
}

function NutritionContent() {
  const id = useId()
  const options = useNutritionOptions()
  const active = useActiveNutritionPlan()
  const history = useNutritionPlanHistory()
  const [chosenTab, setChosenTab] = useState<NutritionTab | null>(null)
  const [entryTab, setEntryTab] = useState<NutritionTab | null>(null)
  const [step, setStep] = useState<CalculatorStep>('inputs')
  const [openedWeekdays, setOpenedWeekdays] = useState(false)
  const [selection, setSelection] = useState<{ result: PreviewResponse; options: PreviewOptions; revision: number } | null>(null)
  const [saveMessage, setSaveMessage] = useState('')
  const previewRevision = useRef(0)
  const shouldFocusStep = useRef(false)
  const shouldFocusActive = useRef(false)
  const stepTitle = useRef<HTMLHeadingElement>(null)
  // The entry default settles once, when the active read first resolves. Later refetches and end-plan
  // invalidations must not move the user away from the tab that shows the result of their own action.
  if (entryTab === null && active.isSuccess) setEntryTab(active.data.plan ? 'active' : 'calculator')
  const currentTab = chosenTab ?? entryTab ?? 'calculator'
  const confirmedActive = active.isSuccess ? active.data : null
  // A failed options refresh keeps the accepted snapshot and any unfinished weekday draft; only a successful
  // read of genuinely different options invalidates the accepted preview for explicit stale review.
  const optionsChanged = options.isSuccess && selection !== null && selection.options !== options.data
  const acceptedSelection = optionsChanged ? null : selection
  const acceptedPreview = acceptedSelection?.result ?? null
  const tabId = (tab: NutritionTab) => `${id}-${tab}-tab`
  const panelId = (tab: NutritionTab) => `${id}-${tab}-panel`
  const methods = options.data?.methods.filter(isPreviewOption) ?? []

  useEffect(() => {
    if (shouldFocusStep.current && currentTab === 'calculator') {
      stepTitle.current?.focus()
      shouldFocusStep.current = false
    }
    if (shouldFocusActive.current && currentTab === 'active') {
      document.getElementById(`${id}-active-tab`)?.focus()
      shouldFocusActive.current = false
    }
  }, [step, currentTab, id])

  function moveToStep(next: CalculatorStep) {
    shouldFocusStep.current = true
    setStep(next)
  }

  function updatePreview(result: PreviewResponse | null) {
    setSelection(result && options.data ? { result, options: options.data, revision: ++previewRevision.current } : null)
    setOpenedWeekdays(false)
    if (result) moveToStep('preview')
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const button = event.target
    if (!(button instanceof HTMLButtonElement) || button.getAttribute('role') !== 'tab') return
    const current = tabs.findIndex((tab) => tab.id === button.value)
    let next: number
    switch (event.key) {
      case 'ArrowRight': next = (current + 1) % tabs.length; break
      case 'ArrowLeft': next = (current + tabs.length - 1) % tabs.length; break
      case 'Home': next = 0; break
      case 'End': next = tabs.length - 1; break
      default: return
    }
    event.preventDefault()
    const nextTab = tabs[next]
    if (!nextTab) return
    setChosenTab(nextTab.id)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <section aria-labelledby="nutrition-title" className="min-w-0 max-w-5xl">
      <title>Nutrition · Emberpath</title>
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">Calculator and plans</p>
      <h1 id="nutrition-title" className="mt-3">Nutrition</h1>
      <p className="page-description">Review provisional energy and weekday targets, then explicitly save or replace a plan. Planned targets are never recorded as food consumed.</p>
      {active.isFetching && currentTab !== 'active' && <p role="status" className="mt-5 text-sm text-text-secondary">Checking saved-plan status. You can use the calculator while this loads.</p>}
      {active.isError && currentTab !== 'active' && <RequestFailure error={active.error} heading="Saved plan status unavailable" onRetry={() => void active.refetch()} retrying={active.isFetching} />}

      <div className="mt-7 grid grid-cols-3 gap-2 border-b border-border-subtle pb-3" role="tablist" aria-label="Nutrition workspace" onKeyDown={navigate}>
        {tabs.map((tab) => <button key={tab.id} id={tabId(tab.id)} value={tab.id} type="button" role="tab" aria-selected={currentTab === tab.id} aria-controls={panelId(tab.id)} tabIndex={currentTab === tab.id ? 0 : -1} onClick={() => setChosenTab(tab.id)} className={`min-h-11 min-w-0 rounded-lg border px-2 py-2 text-sm font-semibold focus-visible:outline-2 ${currentTab === tab.id ? 'border-primary bg-selected text-selected-foreground' : 'border-border-control text-text-secondary hover:bg-surface-hover hover:text-text-primary'}`}>{tab.label}</button>)}
      </div>

      <section id={panelId('active')} role="tabpanel" aria-labelledby={tabId('active')} hidden={currentTab !== 'active'} tabIndex={0} className="min-w-0 pt-6" onFocusCapture={() => { if (chosenTab === null) setChosenTab('active') }}>
        <NutritionActivePlan active={active} history={history} notice={saveMessage} showFailure={currentTab === 'active'} onMessageChange={setSaveMessage} onNewCalculation={() => { setSaveMessage(''); setChosenTab('calculator'); moveToStep('inputs') }} />
      </section>

      <section id={panelId('calculator')} role="tabpanel" aria-labelledby={tabId('calculator')} hidden={currentTab !== 'calculator'} tabIndex={0} className="min-w-0 pt-6" onFocusCapture={() => { if (chosenTab === null) setChosenTab('calculator') }}>
        <h2 className="text-xl font-semibold" tabIndex={-1} ref={stepTitle}>{steps.find((item) => item.id === step)?.label}</h2>
        <ol className="mt-3 grid grid-cols-4 gap-1 text-center text-[11px] sm:gap-2 sm:text-sm" aria-label="Calculator progress">
          {steps.map((item, index) => <li key={item.id} aria-current={step === item.id ? 'step' : undefined} className={`min-w-0 rounded-lg border px-1 py-2 ${step === item.id ? 'border-primary bg-selected font-semibold text-selected-foreground' : 'border-border-subtle text-text-secondary'}`}>
            <span className="block font-semibold">{index + 1}</span>{item.label}
          </li>)}
        </ol>
        {options.isFetching && !options.data && <p className="mt-7" role="status">Loading nutrition methods and starting suggestions…</p>}
        {options.isError && <RequestFailure error={options.error} onRetry={() => void options.refetch()} retrying={options.isFetching} />}
        {!options.isFetching && !options.isError && !options.data && <RequestFailure error={new Error('Missing nutrition options')} onRetry={() => void options.refetch()} />}
        {options.data && !options.isError && methods.length === 0 && <RequestFailure error={new Error('No preview methods available')} onRetry={() => void options.refetch()} />}
        {acceptedPreview && step === 'inputs' && <button type="button" className="secondary-button mt-5" onClick={() => moveToStep('preview')}>Continue to accepted preview</button>}
        {options.data && methods.length > 0 && <div hidden={step !== 'inputs'}>
          <NutritionCalculator options={options.data} methods={methods} onResultChange={updatePreview} />
        </div>}
        {acceptedPreview && step === 'preview' && <>
          <NutritionResult result={acceptedPreview} />
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className="log-button" onClick={() => { setOpenedWeekdays(true); moveToStep('weekdays') }}>Next: Weekday targets</button>
            <button type="button" className="secondary-button" onClick={() => moveToStep('inputs')}>Back to inputs</button>
          </div>
        </>}
        {openedWeekdays && acceptedSelection && <div hidden={step !== 'weekdays' && step !== 'review'} className="mt-6">
          <NutritionPlanEditor
            key={`preview-${acceptedSelection.revision}`}
            acceptedPreview={acceptedSelection.result}
            activeState={confirmedActive}
            step={step === 'review' ? 'review' : 'weekdays'}
            onBack={() => moveToStep(step === 'review' ? 'weekdays' : 'preview')}
            onReview={() => moveToStep('review')}
            onSaved={(plan) => {
              setSaveMessage(`Nutrition plan version ${plan.version} saved. The previous active version remains in history.`)
              setSelection(null)
              setOpenedWeekdays(false)
              setStep('inputs')
              setChosenTab('active')
              shouldFocusActive.current = true
            }}
            onRefreshActive={async () => {
              moveToStep('weekdays')
              void history.refetch()
              const refreshed = await active.refetch()
              return refreshed.isSuccess && !refreshed.isFetching
            }}
          />
        </div>}
        {!acceptedPreview && step !== 'inputs' && !options.isError && <div className="mt-6">
          <p role="alert" className="text-sm text-error">This calculator preview is no longer current. Return to Inputs and request a new preview.</p>
          <button type="button" className="secondary-button mt-3" onClick={() => moveToStep('inputs')}>Back to inputs</button>
        </div>}
      </section>

      <section id={panelId('history')} role="tabpanel" aria-labelledby={tabId('history')} hidden={currentTab !== 'history'} tabIndex={0} className="min-w-0 pt-6">
        <NutritionHistory history={history} />
      </section>
    </section>
  )
}

export function NutritionPage() {
  const { userId, sessionId } = useAuth()
  return <NutritionContent key={`${userId ?? 'anonymous'}:${sessionId ?? 'none'}`} />
}
