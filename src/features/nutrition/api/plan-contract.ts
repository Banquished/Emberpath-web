import { weekdays, type ActivePlanResponse, type AllocationPreviewResponse, type PlanHistoryResponse, type SavedPlan } from '@/entities/nutrition-plan'
import { isDailyTarget, isPreviewResponse } from './preview-contract'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function hasWeekdays(value: unknown): boolean {
  return Array.isArray(value) && value.length === weekdays.length && value.every((day, index) =>
    isRecord(day) && day.weekday === weekdays[index] && isInteger(day.delta_from_average_kcal) && isDailyTarget(day.target))
}

function hasAcceptedPreview(value: unknown): boolean {
  return isRecord(value) &&
    (value.method === 'nasem_2023_adult_tee' || value.method === 'manual_target_v1') &&
    isPreviewResponse(value, value.method)
}

export function isAllocationPreview(value: unknown): value is AllocationPreviewResponse {
  return isRecord(value) && isInteger(value.chosen_average_kcal) && isInteger(value.weekly_total_kcal) &&
    hasWeekdays(value.weekdays) && Array.isArray(value.risk_reasons) &&
    value.risk_reasons.every((reason: unknown) => isRecord(reason) &&
      (reason.code === 'below_estimated_maintenance' || reason.code === 'downward_adjustment_from_manual_base' || reason.code === 'uneven_weekdays') &&
      typeof reason.label === 'string') &&
    typeof value.acknowledgment_required === 'boolean' &&
    value.acknowledgment_required === (value.risk_reasons.length > 0) && typeof value.notice === 'string'
}

function isSavedPlan(value: unknown): value is SavedPlan {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    isInteger(value.version) && value.version >= 1 &&
    typeof value.started_at === 'string' && Number.isFinite(Date.parse(value.started_at)) &&
    (value.ended_at === null || (typeof value.ended_at === 'string' && Number.isFinite(Date.parse(value.ended_at)))) &&
    typeof value.time_zone === 'string' && value.time_zone.length > 0 &&
    hasAcceptedPreview(value.accepted_preview) &&
    isInteger(value.chosen_average_kcal) && isInteger(value.weekly_total_kcal) &&
    hasWeekdays(value.weekdays) && typeof value.day_allocation_risk_acknowledged === 'boolean' &&
    typeof value.notice === 'string'
}

export function isActivePlan(value: unknown): value is ActivePlanResponse {
  return isRecord(value) && isInteger(value.revision) && value.revision >= 0 &&
    (value.plan === null || isSavedPlan(value.plan))
}

export function isSavedActivePlan(value: unknown): value is ActivePlanResponse & { plan: SavedPlan } {
  return isActivePlan(value) && value.plan !== null && value.plan.ended_at === null
}

export function isEndedActivePlan(value: unknown): value is ActivePlanResponse & { plan: null } {
  return isActivePlan(value) && value.plan === null
}

export function isPlanHistory(value: unknown): value is PlanHistoryResponse {
  return isRecord(value) && isInteger(value.revision) && value.revision >= 0 &&
    Array.isArray(value.plans) && value.plans.every(isSavedPlan) &&
    (value.next_before_version === null || (isInteger(value.next_before_version) && value.next_before_version >= 1))
}
