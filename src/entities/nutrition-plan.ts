import type { PreviewResponse } from './nutrition-preview'

export const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
export type Weekday = typeof weekdays[number]

export type WeekdayTarget = {
  weekday: Weekday
  delta_from_average_kcal: number
  target: PreviewResponse['daily_target']
}

export type AllocationRisk = {
  code: 'below_estimated_maintenance' | 'downward_adjustment_from_manual_base' | 'uneven_weekdays'
  label: string
}

export type AllocationPreviewRequest = {
  accepted_preview: PreviewResponse
  weekday_kcal?: number[]
}

export type ActiveAllocationPreviewRequest = {
  expected_revision: number
  weekday_kcal?: number[]
}

export type AllocationPreviewResponse = {
  chosen_average_kcal: number
  weekly_total_kcal: number
  weekdays: WeekdayTarget[]
  risk_reasons: AllocationRisk[]
  acknowledgment_required: boolean
  notice: string
}

export type SavePlanRequest = AllocationPreviewRequest & {
  expected_revision: number
  time_zone: string
  acknowledge_day_allocation_risk?: boolean
}

export type SavedPlan = {
  id: string
  version: number
  started_at: string
  ended_at: string | null
  time_zone: string
  accepted_preview: PreviewResponse
  chosen_average_kcal: number
  weekly_total_kcal: number
  weekdays: WeekdayTarget[]
  day_allocation_risk_acknowledged: boolean
  notice: string
}

export type ActivePlanResponse = { revision: number; plan: SavedPlan | null }
export type PlanHistoryResponse = { revision: number; plans: SavedPlan[]; next_before_version: number | null }
