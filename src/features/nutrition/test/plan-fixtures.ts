import { weekdays, type AllocationPreviewResponse, type SavedPlan, type WeekdayTarget } from '@/entities/nutrition-plan'
import type { PreviewResponse, StartingSuggestions } from '@/entities/nutrition-preview'

const reference = { id: 'who_fat_carbohydrate_2023', url: 'https://www.who.int/news/item/17-07-2023-who-updates-guidelines-on-fats-and-carbohydrates', scope: 'General-adult guidance.' }
export const suggestions: StartingSuggestions = {
  protein_g_per_kg: { value: 1.6, unit: 'g/kg/day', sources: [{ id: 'doi:10.1186/s12970-017-0177-8', url: 'https://pubmed.ncbi.nlm.nih.gov/28642676/', scope: 'Most exercising adults.' }], scope: 'Editable training-focused starting point.' },
  fat_share: { value: 0.3, unit: 'fraction_of_daily_kcal', sources: [reference], scope: 'Editable product allocation, not an individual requirement.' },
  fibre_g_per_day: { value: 25, unit: 'g/day', sources: [reference], scope: 'Naturally occurring dietary fibre.' },
}

export const manualPreview: Extract<PreviewResponse, { method: 'manual_target_v1' }> = {
  method: 'manual_target_v1',
  inputs: {
    method: 'manual_target_v1',
    age_years: 19,
    weight_kg: 80,
    manual_base_target_kcal: 2400,
    calorie_adjustment_kcal: 0,
    strategy: { protein: { mode: 'per_kg', g_per_kg: 1.6 }, fat_share: 0.3, fibre_g_per_day: 25 },
  },
  resting_estimate: null,
  maintenance_estimate: null,
  base_target_kcal: 2400,
  calorie_adjustment_kcal: 0,
  daily_target: { kcal: 2400, protein_g: 128, fat_g: 80, carbohydrate_g: 292, fibre_g: 25 },
  macro_method: 'macro_allocation_4_9_4_v1',
  starting_suggestions: suggestions,
  notice: 'Estimates and targets are provisional, not measurements or medical advice.',
}

export const downwardManualPreview: PreviewResponse = {
  ...manualPreview,
  inputs: { ...manualPreview.inputs, calorie_adjustment_kcal: -100 },
  calorie_adjustment_kcal: -100,
  daily_target: { kcal: 2300, protein_g: 128, fat_g: 76.67, carbohydrate_g: 274.49, fibre_g: 25 },
}

export const dayNotice = 'Day targets are plans, not intake. Weekly balance and mathematical feasibility do not assess individual day-level risk.'
export const flatDays: WeekdayTarget[] = weekdays.map((weekday) => ({
  weekday,
  delta_from_average_kcal: 0,
  target: manualPreview.daily_target,
}))

export const flatAllocation: AllocationPreviewResponse = {
  chosen_average_kcal: 2400,
  weekly_total_kcal: 16800,
  weekdays: flatDays,
  risk_reasons: [],
  acknowledgment_required: false,
  notice: `${dayNotice} An acknowledgment records review of flagged choices, not individual safety.`,
}

export const unevenDays: WeekdayTarget[] = flatDays.map((day) =>
  day.weekday === 'monday'
    ? { weekday: 'monday', delta_from_average_kcal: 200, target: { kcal: 2600, protein_g: 128, fat_g: 86.67, carbohydrate_g: 326.99, fibre_g: 25 } }
    : day.weekday === 'sunday'
      ? { weekday: 'sunday', delta_from_average_kcal: -200, target: { kcal: 2200, protein_g: 128, fat_g: 73.33, carbohydrate_g: 257.01, fibre_g: 25 } }
      : day)

export const unevenAllocation: AllocationPreviewResponse = {
  ...flatAllocation,
  weekdays: unevenDays,
  risk_reasons: [{ code: 'uneven_weekdays', label: 'Some weekday targets differ from the chosen average. A balanced week does not assess individual days.' }],
  acknowledgment_required: true,
}

export const savedPlan: SavedPlan = {
  id: '083c82c3-f14c-429a-a89c-62f79c994be7',
  version: 1,
  started_at: '2026-09-29T16:00:00Z',
  ended_at: null,
  time_zone: 'Europe/Oslo',
  accepted_preview: manualPreview,
  chosen_average_kcal: 2400,
  weekly_total_kcal: 16800,
  weekdays: flatDays,
  day_allocation_risk_acknowledged: false,
  notice: dayNotice,
}
