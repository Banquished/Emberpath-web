import { describe, expect, it } from 'vitest'
import type { WeightLog } from '@/entities/weight-log'
import { chartMeasurements, dateKey, filterMeasurements, periodStart } from './weight-range'

function entry(date: string, weight_kg = 80): WeightLog {
  return { id: date, date, weight_kg }
}

describe('measurement periods', () => {
  it('includes today and the previous six or thirteen calendar days', () => {
    const now = new Date(2026, 8, 19, 0, 15)
    expect(periodStart('1w', now)).toBe('2026-09-13')
    expect(periodStart('2w', now)).toBe('2026-09-06')
    expect(filterMeasurements([
      entry('2026-09-12'), entry('2026-09-13'), entry('2026-09-19'), entry('2026-09-20'),
    ], '1w', now).map((value) => value.date)).toEqual(['2026-09-19', '2026-09-13'])
  })

  it('clamps a calendar month to the last valid day, including leap years', () => {
    expect(periodStart('1m', new Date(2026, 2, 31))).toBe('2026-02-28')
    expect(periodStart('1m', new Date(2024, 2, 31))).toBe('2024-02-29')
    expect(periodStart('12m', new Date(2024, 1, 29))).toBe('2023-02-28')
    expect(periodStart('3m', new Date(2026, 4, 31))).toBe('2026-02-28')
    expect(periodStart('6m', new Date(2026, 7, 31))).toBe('2026-02-28')
  })

  it('keeps calendar-day boundaries across daylight-saving transitions', () => {
    expect(periodStart('1w', new Date(2026, 2, 30, 0, 15))).toBe('2026-03-24')
    expect(periodStart('1w', new Date(2026, 9, 26, 23, 45))).toBe('2026-10-20')
    expect(dateKey(new Date(2026, 8, 19, 0, 1))).toBe('2026-09-19')
  })

  it('sorts newest first without changing the API data and retains old records for all time', () => {
    const entries = [entry('2020-01-01'), entry('2026-09-19'), entry('2025-05-02')]
    expect(filterMeasurements(entries, 'all', new Date(2026, 8, 19)).map((value) => value.date)).toEqual(['2026-09-19', '2025-05-02', '2020-01-01'])
    expect(entries.map((value) => value.date)).toEqual(['2020-01-01', '2026-09-19', '2025-05-02'])
    expect(periodStart('all', new Date())).toBeNull()
  })
})

describe('chart measurements', () => {
  it('orders observations chronologically and inserts a gap without inventing weights', () => {
    const entries = [entry('2026-09-19', 81), entry('2026-09-16', 82)]
    const points = chartMeasurements(entries)
    expect(points.map((point) => ({ date: dateKey(new Date(point.timestamp)), weight: point.weight }))).toEqual([
      { date: '2026-09-16', weight: 82 },
      { date: '2026-09-17', weight: null },
      { date: '2026-09-19', weight: 81 },
    ])
    expect(entries[0]?.date).toBe('2026-09-19')
  })

  it('does not mistake daylight-saving clock changes for missing calendar days', () => {
    for (const dates of [['2026-03-28', '2026-03-29', '2026-03-30'], ['2026-10-24', '2026-10-25', '2026-10-26']]) {
      expect(chartMeasurements(dates.map((date) => entry(date))).map((point) => point.weight)).toEqual([80, 80, 80])
    }
  })

  it('handles empty data and a single observed day', () => {
    expect(chartMeasurements([])).toEqual([])
    expect(chartMeasurements([entry('2026-09-19')])).toEqual([{ timestamp: new Date(2026, 8, 19, 12).getTime(), weight: 80 }])
  })
})

