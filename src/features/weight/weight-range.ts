import type { WeightLog } from '@/entities/weight-log'

export const periods = [
  { value: '1w', label: 'Last week', short: '1W' },
  { value: '2w', label: 'Last 2 weeks', short: '2W' },
  { value: '1m', label: 'Last month', short: '1M' },
  { value: '3m', label: 'Last 3 months', short: '3M' },
  { value: '6m', label: 'Last 6 months', short: '6M' },
  { value: '12m', label: 'Last 12 months', short: '12M' },
  { value: 'all', label: 'All time', short: 'All' },
] as const
export type Period = typeof periods[number]['value']

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function periodStart(period: Period, now: Date) {
  if (period === 'all') return null
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  if (period.endsWith('w')) {
    start.setDate(start.getDate() - (Number.parseInt(period) * 7 - 1))
  } else {
    const day = start.getDate()
    start.setDate(1)
    start.setMonth(start.getMonth() - Number.parseInt(period))
    const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
    start.setDate(Math.min(day, lastDay))
  }
  return dateKey(start)
}

export function filterMeasurements(entries: WeightLog[], period: Period, now: Date) {
  const start = periodStart(period, now)
  const end = dateKey(now)
  return entries.filter((entry) => !start || (entry.date >= start && entry.date <= end))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function chartMeasurements(entries: WeightLog[]) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  const points: { timestamp: number; weight: number | null }[] = []
  sorted.forEach((entry, index) => {
    const date = new Date(`${entry.date}T12:00:00`)
    const previous = sorted[index - 1]
    if (previous) {
      const nextDay = new Date(`${previous.date}T12:00:00`)
      nextDay.setDate(nextDay.getDate() + 1)
      if (dateKey(nextDay) < entry.date) points.push({ timestamp: nextDay.getTime(), weight: null })
    }
    points.push({ timestamp: date.getTime(), weight: entry.weight_kg })
  })
  return points
}
