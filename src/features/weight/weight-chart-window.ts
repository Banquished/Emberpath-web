import type { WeightGoal } from '@/entities/weight-goal'
import { dateKey, periodBounds, type Period } from './weight-range'

const dayMilliseconds = 86_400_000
const calendarDay = (date: string) => Date.parse(`${date}T00:00:00Z`) / dayMilliseconds
const timestamp = (date: string) => new Date(`${date}T12:00:00`).getTime()
const halfWindowPeriods: readonly Period[] = ['1w', '2w', '1m']

function oneCalendarMonthAfter(today: Date) {
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1, 12)
  const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate()
  nextMonth.setDate(Math.min(today.getDate(), lastDay))
  return dateKey(nextMonth)
}

// Short periods look ahead half of their included calendar dates; longer ones look ahead one calendar month.
export function goalPreviewEnd(period: Period, today: Date) {
  const { start, end } = periodBounds(period, today)
  if (!start || !end || !halfWindowPeriods.includes(period)) return oneCalendarMonthAfter(today)
  const includedDates = calendarDay(end) - calendarDay(start) + 1
  return dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + Math.floor(includedDates / 2), 12))
}

export function visibleGoalSegment(goal: WeightGoal, start: string | undefined, previewEnd: string) {
  if (!goal.plan || !goal.target_date || goal.baseline_weight_kg == null) return undefined
  const first = start && start > goal.start_date ? start : goal.start_date
  const last = goal.target_date < previewEnd ? goal.target_date : previewEnd
  const duration = calendarDay(goal.target_date) - calendarDay(goal.start_date)
  if (first >= last || duration <= 0) return undefined
  const baseline = goal.baseline_weight_kg
  const point = (date: string) => ({
    x: timestamp(date),
    y: baseline + (goal.target_weight_kg - baseline) * (calendarDay(date) - calendarDay(goal.start_date)) / duration,
  })
  return [point(first), point(last)] as const
}

export type GoalWindowNotice = 'starts-later' | 'ended-earlier' | 'unavailable'

// Explains why a dated goal has no drawable segment in the visible window, so an enabled goal toggle is never
// silently empty. It reports the reason only; it never widens the horizon or invents a line.
export function goalWindowNotice(goal: WeightGoal, start: string | undefined, previewEnd: string): GoalWindowNotice | undefined {
  if (!goal.plan || !goal.target_date) return undefined
  if (goal.baseline_weight_kg == null) return 'unavailable'
  if (visibleGoalSegment(goal, start, previewEnd)) return undefined
  if (goal.start_date >= previewEnd) return 'starts-later'
  if (start !== undefined && goal.target_date <= start) return 'ended-earlier'
  return 'unavailable'
}

export function chartTimeAxis(timestamps: number[]) {
  const first = Math.min(...timestamps)
  const last = Math.max(...timestamps)
  const domain: [number, number] = first === last ? [first - dayMilliseconds, last + dayMilliseconds] : [first, last]
  const ticks = Array.from({ length: 5 }, (_, index) => domain[0] + (domain[1] - domain[0]) * index / 4)
  return { domain, ticks }
}
