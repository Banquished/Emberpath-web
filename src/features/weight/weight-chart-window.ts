import type { WeightGoal } from '@/entities/weight-goal'
import { dateKey } from './weight-range'

const dayMilliseconds = 86_400_000
const calendarDay = (date: string) => Date.parse(`${date}T00:00:00Z`) / dayMilliseconds
const timestamp = (date: string) => new Date(`${date}T12:00:00`).getTime()

export function goalPreviewEnd(today: Date) {
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1, 12)
  const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate()
  nextMonth.setDate(Math.min(today.getDate(), lastDay))
  return dateKey(nextMonth)
}

export function visibleGoalSegment(goal: WeightGoal, start: string | undefined, today: Date) {
  if (!goal.plan || !goal.target_date || goal.baseline_weight_kg == null) return undefined
  const first = start && start > goal.start_date ? start : goal.start_date
  const cap = goalPreviewEnd(today)
  const last = goal.target_date < cap ? goal.target_date : cap
  const duration = calendarDay(goal.target_date) - calendarDay(goal.start_date)
  if (first >= last || duration <= 0) return undefined
  const baseline = goal.baseline_weight_kg
  const point = (date: string) => ({
    x: timestamp(date),
    y: baseline + (goal.target_weight_kg - baseline) * (calendarDay(date) - calendarDay(goal.start_date)) / duration,
  })
  return [point(first), point(last)] as const
}

export function chartTimeAxis(timestamps: number[]) {
  const first = Math.min(...timestamps)
  const last = Math.max(...timestamps)
  const domain: [number, number] = first === last ? [first - dayMilliseconds, last + dayMilliseconds] : [first, last]
  const ticks = Array.from({ length: 5 }, (_, index) => domain[0] + (domain[1] - domain[0]) * index / 4)
  return { domain, ticks }
}
