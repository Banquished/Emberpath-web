export type PreviewMethod = 'nasem_2023_adult_tee' | 'manual_target_v1'
export type FormulaParameter = 'male' | 'female'
export type ActivityCategory = 'inactive' | 'low_active' | 'active' | 'very_active'

export type ProteinSelection =
  | { mode: 'per_kg'; g_per_kg: number }
  | { mode: 'daily_grams'; g_per_day: number }

export type NutritionStrategy = {
  protein: ProteinSelection
  fat_share: number
  fibre_g_per_day: number
}

type CommonPreviewRequest = {
  age_years: number
  weight_kg: number
  calorie_adjustment_kcal: number
  strategy: NutritionStrategy
}

export type CalculatedPreviewRequest = CommonPreviewRequest & {
  method: 'nasem_2023_adult_tee'
  height_cm: number
  formula: FormulaParameter
  activity: ActivityCategory
}

export type ManualPreviewRequest = CommonPreviewRequest & {
  method: 'manual_target_v1'
  manual_base_target_kcal: number
}

export type PreviewRequest = CalculatedPreviewRequest | ManualPreviewRequest

export type SourceReference = {
  id: string
  url: string
  scope: string
}

export type StartingSuggestion<Unit extends string> = {
  value: number
  unit: Unit
  sources: SourceReference[]
  scope: string
}

export type StartingSuggestions = {
  protein_g_per_kg: StartingSuggestion<'g/kg/day'>
  fat_share: StartingSuggestion<'fraction_of_daily_kcal'>
  fibre_g_per_day: StartingSuggestion<'g/day'>
}

export type MethodOption = {
  id: PreviewMethod | 'mifflin_st_jeor_1990_original'
  source_id: string | null
  source_url: string | null
  scope: string
}

export type PreviewOptions = {
  methods: MethodOption[]
  formula_parameters: FormulaParameter[]
  activity_categories: {
    id: ActivityCategory
    pal_min_inclusive: number
    pal_max_exclusive: number
  }[]
  activity_source_url: string
  starting_suggestions: StartingSuggestions
  notice: string
}

type CommonPreviewResponse = {
  base_target_kcal: number
  calorie_adjustment_kcal: number
  daily_target: {
    kcal: number
    protein_g: number
    fat_g: number
    carbohydrate_g: number
    fibre_g: number
  }
  macro_method: 'macro_allocation_4_9_4_v1'
  starting_suggestions: StartingSuggestions
  notice: string
}

export type PreviewResponse = CommonPreviewResponse & (
  | {
    method: 'nasem_2023_adult_tee'
    inputs: CalculatedPreviewRequest
    resting_estimate: {
      method: 'mifflin_st_jeor_1990_original'
      source_id: string
      source_url: string
      kcal_per_day: number
    }
    maintenance_estimate: {
      method: 'nasem_2023_adult_tee'
      source_id: string
      source_url: string
      kcal_per_day: number
    }
  }
  | {
    method: 'manual_target_v1'
    inputs: ManualPreviewRequest
    resting_estimate: null
    maintenance_estimate: null
  }
)
