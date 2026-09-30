import type { Weekday } from '@/entities/nutrition-plan'

export function weekdayLabel(day: Weekday): string {
  return day.charAt(0).toUpperCase() + day.slice(1)
}
