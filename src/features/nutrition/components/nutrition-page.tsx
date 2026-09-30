import { useAuth } from '@clerk/react'
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { MethodOption, PreviewMethod, PreviewOptions, PreviewResponse, StartingSuggestion } from '@/entities/nutrition-preview'
import { useNutritionOptions, useNutritionPreview } from '../api/nutrition-estimates'
import { NutritionRequestError } from '../api/nutrition-request'
import { initialValues, validatePreview, type FormErrors, type PreviewFormValues } from '../preview-form'
import { NutritionPlans, type PlanEditorMode } from './nutrition-plans'
import { RequestFailure } from './nutrition-request-failure'
import { NutritionResult } from './nutrition-result'

const methodLabels: Record<PreviewMethod, string> = {
  nasem_2023_adult_tee: 'Calculate adult energy estimates',
  manual_target_v1: 'Enter a manual base target',
}

const formulaLabels = { male: 'Male equation', female: 'Female equation' } as const
const activityLabels = { inactive: 'Inactive', low_active: 'Low active', active: 'Active', very_active: 'Very active' } as const
const inputClass = 'min-h-12 w-full rounded-lg border border-border-control bg-background px-3 py-2 text-text-primary aria-invalid:border-error'

function isPreviewOption(option: MethodOption): option is MethodOption & { id: PreviewMethod } {
  return option.id === 'nasem_2023_adult_tee' || option.id === 'manual_target_v1'
}

function SuggestionSource({ suggestion, display }: { suggestion: StartingSuggestion<string>; display: string }) {
  return (
    <div className="text-sm text-text-secondary">
      <p>Editable starting suggestion: <strong className="text-text-primary">{display}</strong>. {suggestion.scope}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {suggestion.sources.map((source) => (
          <li key={source.id}>
            <a className="break-words text-info underline underline-offset-2" href={source.url}>{source.id}</a>: {source.scope}
          </li>
        ))}
      </ul>
    </div>
  )
}

function NumberField({ id, name, label, value, onChange, min, max, step = 'any', error, help }: {
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
}) {
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className="min-w-0 space-y-2">
      <label className="block text-sm font-semibold" htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        className={inputClass}
        type="number"
        inputMode={step === '1' ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        step={step}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[helpId, errorId].filter(Boolean).join(' ') || undefined}
      />
      {help && <div id={helpId}>{help}</div>}
      {error && <p className="text-sm text-error" id={errorId}>{error}</p>}
    </div>
  )
}

function NutritionCalculator({ options, methods, result, onResultChange }: {
  options: PreviewOptions
  methods: (MethodOption & { id: PreviewMethod })[]
  result: PreviewResponse | null
  onResultChange: (result: PreviewResponse | null) => void
}) {
  const id = useId()
  const [values, setValues] = useState(() => initialValues(options))
  const [errors, setErrors] = useState<FormErrors>({})
  const [failure, setFailure] = useState<Error | null>(null)
  const revision = useRef(0)
  const preview = useNutritionPreview()

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
    <>
      <section className="mt-8 rounded-2xl border border-border-subtle bg-surface p-5 sm:p-8" aria-labelledby={`${id}-form-title`}>
        <h2 className="text-xl font-semibold" id={`${id}-form-title`}>Calculate a preview</h2>
        <p className="mt-2 text-sm text-text-secondary">Enter your own measurements. The calculator never reads the Weight journal. All fields below are required for the selected method.</p>
        <form className="mt-7 space-y-8" onSubmit={submit} noValidate aria-label="Nutrition preview">
          <fieldset>
            <legend className="text-lg font-semibold">Preview method</legend>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {methods.map((method) => (
                <div className={`min-w-0 rounded-xl border p-4 ${values.method === method.id ? 'border-primary bg-selected' : 'border-border-control'}`} key={method.id}>
                  <label className="flex cursor-pointer items-start gap-3 font-semibold">
                    <input
                      className="mt-1"
                      type="radio"
                      name="method"
                      value={method.id}
                      checked={values.method === method.id}
                      onChange={() => change('method', method.id)}
                      aria-invalid={errors.method ? true : undefined}
                      aria-describedby={`${id}-${method.id}-scope${methodErrorId ? ` ${methodErrorId}` : ''}`}
                    />
                    {methodLabels[method.id]}
                  </label>
                  <p className="mt-2 text-sm text-text-secondary" id={`${id}-${method.id}-scope`}>{method.scope}</p>
                  {method.source_url && <a className="mt-2 inline-block break-words text-sm text-info underline underline-offset-2" href={method.source_url}>Method source: {method.source_id}</a>}
                </div>
              ))}
            </div>
            {errors.method && <p className="mt-2 text-sm text-error" id={methodErrorId}>{errors.method}</p>}
          </fieldset>

          <fieldset>
            <legend className="text-lg font-semibold">Your inputs</legend>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <NumberField id={`${id}-age`} name="ageYears" label="Age (completed years)" value={values.ageYears} onChange={(value) => change('ageYears', value)} min={19} max={120} step="1" error={errors.ageYears} help={<p className="text-sm text-text-secondary">For adults age 19 and older; not an individual safety assessment.</p>} />
              <NumberField id={`${id}-weight`} name="weightKg" label="Manually entered weight (kg)" value={values.weightKg} onChange={(value) => change('weightKg', value)} min={20} max={400} error={errors.weightKg} />
              {calculated && <>
                <NumberField id={`${id}-height`} name="heightCm" label="Height (cm)" value={values.heightCm} onChange={(value) => change('heightCm', value)} min={100} max={250} error={errors.heightCm} />
                <div className="min-w-0 space-y-2">
                  <label className="block text-sm font-semibold" htmlFor={`${id}-formula`}>Formula parameter</label>
                  <select id={`${id}-formula`} name="formula" className={inputClass} required value={values.formula} onChange={(event) => change('formula', options.formula_parameters.find((formula) => formula === event.target.value) ?? '')} aria-invalid={errors.formula ? true : undefined} aria-describedby={`${id}-formula-help${formulaErrorId ? ` ${formulaErrorId}` : ''}`}>
                    <option value="">Choose a formula parameter</option>
                    {options.formula_parameters.map((formula) => <option key={formula} value={formula}>{formulaLabels[formula]}</option>)}
                  </select>
                  <p className="text-sm text-text-secondary" id={`${id}-formula-help`}>Select the equation parameter explicitly; it is not inferred from your account identity.</p>
                  {errors.formula && <p className="text-sm text-error" id={formulaErrorId}>{errors.formula}</p>}
                </div>
                <div className="min-w-0 space-y-2 sm:col-span-2">
                  <label className="block text-sm font-semibold" htmlFor={`${id}-activity`}>General activity category</label>
                  <select id={`${id}-activity`} name="activity" className={inputClass} required value={values.activity} onChange={(event) => change('activity', options.activity_categories.find((activity) => activity.id === event.target.value)?.id ?? '')} aria-invalid={errors.activity ? true : undefined} aria-describedby={`${id}-activity-help${activityErrorId ? ` ${activityErrorId}` : ''}`}>
                    <option value="">Choose an activity category</option>
                    {options.activity_categories.map((activity) => <option key={activity.id} value={activity.id}>{activityLabels[activity.id]} (PAL {activity.pal_min_inclusive.toFixed(2)} to &lt;{activity.pal_max_exclusive.toFixed(2)})</option>)}
                  </select>
                  <p className="text-sm text-text-secondary" id={`${id}-activity-help`}>General PAL ranges, not a sport, step or workout preset. <a className="text-info underline underline-offset-2" href={options.activity_source_url}>Activity category source</a>.</p>
                  {errors.activity && <p className="text-sm text-error" id={activityErrorId}>{errors.activity}</p>}
                </div>
              </>}
              {values.method === 'manual_target_v1' && <NumberField id={`${id}-base`} name="manualBaseKcal" label="Manual base target (kcal/day)" value={values.manualBaseKcal} onChange={(value) => change('manualBaseKcal', value)} min={1} max={20000} step="1" error={errors.manualBaseKcal} help={<p className="text-sm text-text-secondary">Your chosen starting target, not an estimated resting or maintenance expenditure.</p>} />}
              <NumberField id={`${id}-adjustment`} name="adjustmentKcal" label="Chosen calorie adjustment (kcal/day)" value={values.adjustmentKcal} onChange={(value) => change('adjustmentKcal', value)} min={-20000} max={20000} step="1" error={errors.adjustmentKcal} help={<p className="text-sm text-text-secondary">Enter a signed amount or 0. No preset adjustment is assumed safe.</p>} />
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-lg font-semibold">Editable nutrient strategy</legend>
            <p className="mt-2 text-sm text-text-secondary">Starting suggestions are not measured needs. Choose your own values before previewing.</p>
            <div className="mt-5 space-y-6">
              <div>
                <span className="block text-sm font-semibold" id={`${id}-protein-mode-label`}>Protein target mode</span>
                <div className="mt-2 flex flex-wrap gap-5" role="group" aria-labelledby={`${id}-protein-mode-label`}>
                  <label className="flex items-center gap-2"><input type="radio" name="proteinMode" checked={values.proteinMode === 'per_kg'} onChange={() => change('proteinMode', 'per_kg')} />Per kg of entered weight</label>
                  <label className="flex items-center gap-2"><input type="radio" name="proteinMode" checked={values.proteinMode === 'daily_grams'} onChange={() => change('proteinMode', 'daily_grams')} />Fixed daily grams</label>
                </div>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                {values.proteinMode === 'per_kg'
                  ? <NumberField id={`${id}-protein-per-kg`} name="proteinPerKg" label="Protein (g/kg/day)" value={values.proteinPerKg} onChange={(value) => change('proteinPerKg', value)} min={0.01} max={5} error={errors.proteinPerKg} help={<SuggestionSource suggestion={suggestions.protein_g_per_kg} display={`${suggestions.protein_g_per_kg.value} ${suggestions.protein_g_per_kg.unit}`} />} />
                  : <NumberField id={`${id}-protein-grams`} name="proteinDailyGrams" label="Protein (g/day)" value={values.proteinDailyGrams} onChange={(value) => change('proteinDailyGrams', value)} min={0.01} max={2000} error={errors.proteinDailyGrams} help={<p className="text-sm text-text-secondary">Enter a fixed amount. The per-kg starting suggestion does not set this value.</p>} />}
                <NumberField id={`${id}-fat`} name="fatPercent" label="Fat share (% of daily calories)" value={values.fatPercent} onChange={(value) => change('fatPercent', value)} min={0} max={100} error={errors.fatPercent} help={<SuggestionSource suggestion={suggestions.fat_share} display={`${suggestions.fat_share.value * 100}% (fraction ${suggestions.fat_share.value})`} />} />
                <NumberField id={`${id}-fibre`} name="fibreGrams" label="Fibre (g/day)" value={values.fibreGrams} onChange={(value) => change('fibreGrams', value)} min={0} max={100} error={errors.fibreGrams} help={<SuggestionSource suggestion={suggestions.fibre_g_per_day} display={`${suggestions.fibre_g_per_day.value} ${suggestions.fibre_g_per_day.unit}`} />} />
              </div>
              {values.proteinMode === 'daily_grams' && <SuggestionSource suggestion={suggestions.protein_g_per_kg} display={`${suggestions.protein_g_per_kg.value} ${suggestions.protein_g_per_kg.unit} (not applied in fixed mode)`} />}
            </div>
          </fieldset>

          {Object.keys(errors).length > 0 && <p className="text-sm text-error" role="alert">Check the indicated inputs and try again.</p>}
          <button type="submit" className="log-button" disabled={preview.isPending}>{preview.isPending ? 'Calculating…' : failure ? 'Retry preview' : 'Preview daily targets'}</button>
          <p className="text-sm text-text-secondary">{options.notice} This action does not save a plan or log food consumed.</p>
        </form>
      </section>
      {preview.isPending && <p className="mt-5 text-text-secondary" role="status">Calculating your provisional preview…</p>}
      {failure && <RequestFailure error={failure} />}
      {result && <NutritionResult result={result} />}
    </>
  )
}

function NutritionContent() {
  const options = useNutritionOptions()
  const [selection, setSelection] = useState<{ result: PreviewResponse; options: PreviewOptions; revision: number } | null>(null)
  const [mode, setMode] = useState<PlanEditorMode>(null)
  const previewRevision = useRef(0)
  const acceptedPreview = options.isSuccess && !options.isFetching && selection?.options === options.data ? selection.result : null

  function updatePreview(result: PreviewResponse | null) {
    setSelection(result && options.data ? { result, options: options.data, revision: ++previewRevision.current } : null)
    setMode(result ? 'new' : null)
  }

  return (
    <section aria-labelledby="nutrition-title" className="max-w-5xl">
      <title>Nutrition · Emberpath</title>
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">Calculator and plans</p>
      <h1 id="nutrition-title" className="mt-3">Nutrition</h1>
      <p className="page-description">Review provisional energy and weekday targets, then explicitly save or replace a plan. Planned targets are never recorded as food consumed.</p>
      {options.isFetching && !options.isError && <p className="mt-8" role="status">Loading nutrition methods and starting suggestions…</p>}
      {options.isError && <RequestFailure error={options.error} onRetry={() => void options.refetch()} retrying={options.isFetching} />}
      {!options.isFetching && !options.isError && !options.data && <RequestFailure error={new Error('Missing nutrition options')} onRetry={() => void options.refetch()} />}
      {options.data && !options.isFetching && !options.isError && (() => {
        const methods = options.data.methods.filter(isPreviewOption)
        return methods.length > 0
          ? <NutritionCalculator options={options.data} methods={methods} result={acceptedPreview} onResultChange={updatePreview} />
          : <RequestFailure error={new Error('No preview methods available')} onRetry={() => void options.refetch()} />
      })()}
      <NutritionPlans
        acceptedPreview={acceptedPreview}
        previewRevision={selection?.revision ?? 0}
        mode={mode}
        onModeChange={setMode}
        onConfirmedSave={() => { setSelection(null); setMode(null) }}
      />
    </section>
  )
}

export function NutritionPage() {
  const { userId, sessionId } = useAuth()
  return <NutritionContent key={`${userId ?? 'anonymous'}:${sessionId ?? 'none'}`} />
}
