import type { ActivityCategory, FormulaParameter, PreviewOptions, PreviewRequest, PreviewMethod, ProteinSelection } from '@/entities/nutrition-preview'
import { proteinLimits } from './protein-review'

export type PreviewFormValues = {
  method: PreviewMethod | ''
  ageYears: string
  weightKg: string
  heightCm: string
  formula: FormulaParameter | ''
  activity: ActivityCategory | ''
  manualBaseKcal: string
  adjustmentKcal: string
  proteinMode: ProteinSelection['mode']
  proteinPerKg: string
  proteinDailyGrams: string
  fatPercent: string
  fibreGrams: string
}

export type FormErrors = Partial<Record<keyof PreviewFormValues, string>>

export function initialValues(options: PreviewOptions): PreviewFormValues {
  return {
    method: '',
    ageYears: '',
    weightKg: '',
    heightCm: '',
    formula: '',
    activity: '',
    manualBaseKcal: '',
    adjustmentKcal: '0',
    proteinMode: 'per_kg',
    proteinPerKg: String(options.starting_suggestions.protein_g_per_kg.value),
    proteinDailyGrams: '',
    fatPercent: String(options.starting_suggestions.fat_share.value * 100),
    fibreGrams: String(options.starting_suggestions.fibre_g_per_day.value),
  }
}

export function validatePreview(values: PreviewFormValues): { request: PreviewRequest | null; errors: FormErrors } {
  const errors: FormErrors = {}
  function read(field: keyof PreviewFormValues, label: string, min: number, max: number, integer = false): number | null {
    const raw = values[field]
    const value = Number(raw)
    if (!raw.trim() || !Number.isFinite(value)) {
      errors[field] = `Enter a valid ${label.toLowerCase()}.`
    } else if (integer && !Number.isInteger(value)) {
      errors[field] = `${label} must be a whole number.`
    } else if (value < min || value > max) {
      errors[field] = `${label} must be between ${min} and ${max}.`
    } else {
      return value
    }
    return null
  }

  if (!values.method) errors.method = 'Choose a preview method.'
  const age = read('ageYears', 'Age in years', 19, 120, true)
  const enteredAge = Number(values.ageYears)
  if (values.ageYears.trim() && Number.isInteger(enteredAge) && enteredAge < 19) errors.ageYears = 'Age under 19 is not supported by this calculator.'
  const weight = read('weightKg', 'Weight in kg', ...proteinLimits.weightKg)
  const adjustment = read('adjustmentKcal', 'Calorie adjustment in kcal/day', -20000, 20000, true)
  const proteinValue = values.proteinMode === 'per_kg'
    ? read('proteinPerKg', 'Protein in g/kg/day', ...proteinLimits.perKg)
    : read('proteinDailyGrams', 'Protein in g/day', ...proteinLimits.dailyGrams)
  const fatPercent = read('fatPercent', 'Fat share in percent', 0, 100)
  const fibre = read('fibreGrams', 'Fibre in g/day', 0, 100)
  const height = values.method === 'nasem_2023_adult_tee' ? read('heightCm', 'Height in cm', 100, 250) : null
  const base = values.method === 'manual_target_v1' ? read('manualBaseKcal', 'Manual base target in kcal/day', 1, 20000, true) : null
  if (values.method === 'nasem_2023_adult_tee') {
    if (!values.formula) errors.formula = 'Choose a formula parameter.'
    if (!values.activity) errors.activity = 'Choose an activity category.'
  }
  if (Object.keys(errors).length || age === null || weight === null || adjustment === null || proteinValue === null || fatPercent === null || fibre === null) {
    return { request: null, errors }
  }

  const protein: ProteinSelection = values.proteinMode === 'per_kg'
    ? { mode: 'per_kg', g_per_kg: proteinValue }
    : { mode: 'daily_grams', g_per_day: proteinValue }
  const common = {
    age_years: age,
    weight_kg: weight,
    calorie_adjustment_kcal: adjustment,
    strategy: { protein, fat_share: fatPercent / 100, fibre_g_per_day: fibre },
  }
  if (values.method === 'nasem_2023_adult_tee' && height !== null && values.formula && values.activity) {
    return { request: { ...common, method: values.method, height_cm: height, formula: values.formula, activity: values.activity }, errors }
  }
  if (values.method === 'manual_target_v1' && base !== null) {
    return { request: { ...common, method: values.method, manual_base_target_kcal: base }, errors }
  }
  return { request: null, errors }
}
