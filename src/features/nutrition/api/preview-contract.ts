import type { PreviewMethod, PreviewOptions, PreviewResponse } from '@/entities/nutrition-preview'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSource(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && typeof value.url === 'string' && typeof value.scope === 'string'
}

function isSuggestion(value: unknown, unit: string, min: number, max: number): boolean {
  return isRecord(value) && isFiniteNumber(value.value) && value.value >= min && value.value <= max &&
    value.unit === unit && typeof value.scope === 'string' &&
    Array.isArray(value.sources) && value.sources.length > 0 && value.sources.every(isSource)
}

function hasSuggestions(value: unknown): boolean {
  return isRecord(value) &&
    isSuggestion(value.protein_g_per_kg, 'g/kg/day', 0.01, 5) &&
    isSuggestion(value.fat_share, 'fraction_of_daily_kcal', 0, 1) &&
    isSuggestion(value.fibre_g_per_day, 'g/day', 0, 100)
}

function isMethodOption(value: unknown): boolean {
  return isRecord(value) &&
    (value.id === 'mifflin_st_jeor_1990_original' || value.id === 'nasem_2023_adult_tee' || value.id === 'manual_target_v1') &&
    (value.source_id === null || typeof value.source_id === 'string') &&
    (value.source_url === null || typeof value.source_url === 'string') &&
    typeof value.scope === 'string'
}

function isActivityOption(value: unknown): boolean {
  return isRecord(value) &&
    (value.id === 'inactive' || value.id === 'low_active' || value.id === 'active' || value.id === 'very_active') &&
    isFiniteNumber(value.pal_min_inclusive) && isFiniteNumber(value.pal_max_exclusive) &&
    value.pal_min_inclusive < value.pal_max_exclusive
}

export function isPreviewOptions(value: unknown): value is PreviewOptions {
  if (!isRecord(value)) return false
  const { methods, formula_parameters: formulas, activity_categories: activities, activity_source_url: activitySource, notice, starting_suggestions: suggestions } = value
  if (!Array.isArray(methods) || !methods.every(isMethodOption) ||
    !Array.isArray(formulas) || !formulas.every((formula) => formula === 'male' || formula === 'female') ||
    !Array.isArray(activities) || !activities.every(isActivityOption) ||
    typeof activitySource !== 'string' || typeof notice !== 'string' ||
    !hasSuggestions(suggestions)) return false
  return methods.some((method) => method.id === 'nasem_2023_adult_tee') &&
    methods.some((method) => method.id === 'manual_target_v1') &&
    formulas.includes('male') && formulas.includes('female') &&
    ['inactive', 'low_active', 'active', 'very_active'].every((id) => activities.some((activity) => activity.id === id))
}

function hasProtein(value: unknown): boolean {
  if (!isRecord(value)) return false
  return value.mode === 'per_kg'
    ? isFiniteNumber(value.g_per_kg) && value.g_per_kg >= 0.01 && value.g_per_kg <= 5
    : value.mode === 'daily_grams' && isFiniteNumber(value.g_per_day) && value.g_per_day >= 0.01 && value.g_per_day <= 2000
}

function hasInputs(value: unknown, method: PreviewMethod): boolean {
  if (!isRecord(value) || value.method !== method || !Number.isInteger(value.age_years) ||
    !isFiniteNumber(value.age_years) || value.age_years < 19 || value.age_years > 120 ||
    !isFiniteNumber(value.weight_kg) || value.weight_kg < 20 || value.weight_kg > 400 ||
    !Number.isInteger(value.calorie_adjustment_kcal) || !isFiniteNumber(value.calorie_adjustment_kcal) ||
    !isRecord(value.strategy) || !hasProtein(value.strategy.protein) ||
    !isFiniteNumber(value.strategy.fat_share) || !isFiniteNumber(value.strategy.fibre_g_per_day)) return false
  if (method === 'nasem_2023_adult_tee') {
    return isFiniteNumber(value.height_cm) && value.height_cm >= 100 && value.height_cm <= 250 &&
      (value.formula === 'male' || value.formula === 'female') &&
      (value.activity === 'inactive' || value.activity === 'low_active' || value.activity === 'active' || value.activity === 'very_active')
  }
  return Number.isInteger(value.manual_base_target_kcal) && isFiniteNumber(value.manual_base_target_kcal) &&
    value.manual_base_target_kcal >= 1 && value.manual_base_target_kcal <= 20000
}

function isEstimate(value: unknown, method: string): boolean {
  return isRecord(value) && value.method === method && Number.isInteger(value.kcal_per_day) &&
    isFiniteNumber(value.kcal_per_day) && value.kcal_per_day > 0 &&
    typeof value.source_id === 'string' && typeof value.source_url === 'string'
}

export function isDailyTarget(value: unknown): value is PreviewResponse['daily_target'] {
  return isRecord(value) && Number.isInteger(value.kcal) && isFiniteNumber(value.kcal) &&
    value.kcal >= 1 && value.kcal <= 20000 &&
    isFiniteNumber(value.protein_g) && value.protein_g >= 0 &&
    isFiniteNumber(value.fat_g) && value.fat_g >= 0 &&
    isFiniteNumber(value.carbohydrate_g) && value.carbohydrate_g >= 0 &&
    isFiniteNumber(value.fibre_g) && value.fibre_g >= 0
}

export function isPreviewResponse(value: unknown, method: PreviewMethod): value is PreviewResponse {
  if (!isRecord(value) || value.method !== method || !hasInputs(value.inputs, method) ||
    !Number.isInteger(value.base_target_kcal) || !isFiniteNumber(value.base_target_kcal) ||
    !Number.isInteger(value.calorie_adjustment_kcal) || !isFiniteNumber(value.calorie_adjustment_kcal) ||
    !isDailyTarget(value.daily_target) || value.macro_method !== 'macro_allocation_4_9_4_v1' ||
    !hasSuggestions(value.starting_suggestions) || typeof value.notice !== 'string') return false
  return method === 'nasem_2023_adult_tee'
    ? isEstimate(value.resting_estimate, 'mifflin_st_jeor_1990_original') &&
        isEstimate(value.maintenance_estimate, 'nasem_2023_adult_tee')
    : value.resting_estimate === null && value.maintenance_estimate === null
}
