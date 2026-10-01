import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeightGoal } from '@/entities/weight-goal'
import { chartTimeAxis, goalPreviewEnd, goalWindowNotice, visibleGoalSegment } from './weight-chart-window'
import type { Period } from './weight-range'

const goal: WeightGoal = { id: 'goal', status: 'active', start_date: '2026-09-21', target_date: '2027-01-01', baseline_weight_kg: 101.5, target_weight_kg: 96, plan: { duration_days: 102, total_change_kg: -5.5, weekly_change_kg: -0.38, fortnightly_change_kg: -0.75 }, created_at: '', ended_at: null }
const timestamp = (date: string) => new Date(`${date}T12:00:00`).getTime()
const noon = (date: string) => new Date(`${date}T12:00:00`)
const dayCount = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
const weightOn = (date: string) => 101.5 - 5.5 * dayCount('2026-09-21', date) / 102

describe('goal preview horizon', () => {
  it.each<[Period, string]>([
    ['1w', '2026-09-22'],
    ['2w', '2026-09-26'],
    ['1m', '2026-10-05'],
    ['3m', '2026-10-19'],
    ['6m', '2026-10-19'],
    ['12m', '2026-10-19'],
    ['all', '2026-10-19'],
  ])('looks ahead from 2026-09-19 in %s to %s', (period, expected) => {
    expect(goalPreviewEnd(period, noon('2026-09-19'))).toBe(expected)
  })

  it.each([
    ['2026-09-19', '2026-09-22'],
    ['2026-12-30', '2027-01-02'],
    ['2026-02-26', '2026-03-01'],
    ['2028-02-27', '2028-03-01'],
  ])('uses half of the 7 included dates in 1W from %s: %s', (today, expected) => {
    expect(goalPreviewEnd('1w', noon(today))).toBe(expected)
  })

  it.each([
    ['2026-09-19', '2026-09-26'],
    ['2026-12-28', '2027-01-04'],
    ['2028-02-25', '2028-03-03'],
  ])('uses half of the 14 included dates in 2W from %s: %s', (today, expected) => {
    expect(goalPreviewEnd('2w', noon(today))).toBe(expected)
  })

  it.each([
    ['2026-03-01', 29, '2026-03-15'],
    ['2026-03-28', 29, '2026-04-11'],
    ['2026-03-29', 30, '2026-04-13'],
    ['2026-03-30', 31, '2026-04-14'],
    ['2026-03-31', 32, '2026-04-16'],
    ['2026-09-19', 32, '2026-10-05'],
    ['2028-03-01', 30, '2028-03-16'],
    ['2028-03-31', 32, '2028-04-16'],
    ['2026-01-31', 32, '2026-02-16'],
    ['2026-12-31', 32, '2027-01-16'],
  ])('uses half of the actual included dates in 1M from %s (%i dates): %s', (today, _includedDates, expected) => {
    expect(goalPreviewEnd('1m', noon(today))).toBe(expected)
  })

  it.each<[Period, string, string]>([
    ['3m', '2026-01-31', '2026-02-28'],
    ['6m', '2026-01-31', '2026-02-28'],
    ['12m', '2028-01-31', '2028-02-29'],
    ['all', '2028-01-31', '2028-02-29'],
    ['6m', '2026-12-31', '2027-01-31'],
    ['all', '2026-08-31', '2026-09-30'],
    ['3m', '2026-10-31', '2026-11-30'],
    ['12m', '2026-11-15', '2026-12-15'],
  ])('uses one calendar month in %s from %s, clamped to %s', (period, today, expected) => {
    expect(goalPreviewEnd(period, noon(today))).toBe(expected)
  })

  it('does not extend a half-year view by half of the range', () => {
    expect(goalPreviewEnd('6m', noon('2026-09-19'))).not.toBe('2026-12-19')
  })

  describe.each([
    {
      zone: 'Europe/Oslo',
      springEve: [2026, 2, 28] as const, expectedSpring: { '1w': '2026-03-31', '2w': '2026-04-04', '1m': '2026-04-11' },
      fallDay: [2026, 9, 25] as const, expectedFall: { '1w': '2026-10-28', '2w': '2026-11-01', '3m': '2026-11-25' },
    },
    {
      zone: 'America/New_York',
      springEve: [2026, 2, 7] as const, expectedSpring: { '1w': '2026-03-10', '2w': '2026-03-14', '1m': '2026-03-21' },
      fallDay: [2026, 10, 1] as const, expectedFall: { '1w': '2026-11-04', '2w': '2026-11-08', '3m': '2026-12-01' },
    },
  ])('across daylight-saving changes in $zone', ({ zone, springEve, expectedSpring, fallDay, expectedFall }) => {
    beforeEach(() => { vi.stubEnv('TZ', zone) })
    afterEach(() => { vi.unstubAllEnvs() })

    it('runs in a zone whose offset changes on the tested days', () => {
      const [springYear, springMonth, springDate] = springEve
      const [fallYear, fallMonth, fallDate] = fallDay
      expect(new Date(springYear, springMonth, springDate + 2, 12).getTimezoneOffset()).not.toBe(new Date(springYear, springMonth, springDate, 12).getTimezoneOffset())
      expect(new Date(fallYear, fallMonth, fallDate + 2, 12).getTimezoneOffset()).not.toBe(new Date(fallYear, fallMonth, fallDate - 1, 12).getTimezoneOffset())
    })

    it('counts calendar dates late in the evening before a spring-forward change', () => {
      const [year, month, date] = springEve
      const today = new Date(year, month, date, 23, 30)
      expect(goalPreviewEnd('1w', today)).toBe(expectedSpring['1w'])
      expect(goalPreviewEnd('2w', today)).toBe(expectedSpring['2w'])
      expect(goalPreviewEnd('1m', today)).toBe(expectedSpring['1m'])
    })

    it('counts calendar dates shortly after midnight on a fall-back day', () => {
      const [year, month, date] = fallDay
      const today = new Date(year, month, date, 0, 30)
      expect(goalPreviewEnd('1w', today)).toBe(expectedFall['1w'])
      expect(goalPreviewEnd('2w', today)).toBe(expectedFall['2w'])
      expect(goalPreviewEnd('3m', today)).toBe(expectedFall['3m'])
    })

    it('measures planned-path progress in calendar days instead of elapsed hours', () => {
      const dstGoal: WeightGoal = { ...goal, start_date: '2026-10-20', target_date: '2026-11-03', baseline_weight_kg: 100, target_weight_kg: 98, plan: { duration_days: 14, total_change_kg: -2, weekly_change_kg: -1, fortnightly_change_kg: -2 } }
      const segment = visibleGoalSegment(dstGoal, '2026-10-27', '2026-11-03')!
      expect(segment[0]).toEqual({ x: timestamp('2026-10-27'), y: 99 })
      expect(segment[1]).toEqual({ x: timestamp('2026-11-03'), y: 98 })
    })
  })
})

describe('visible goal segment', () => {
  it('clips the future path to the preview end without changing its original rate or deadline', () => {
    const segment = visibleGoalSegment(goal, undefined, '2026-10-21')!
    expect(segment[0]).toEqual({ x: timestamp('2026-09-21'), y: 101.5 })
    expect(segment[1].x).toBe(timestamp('2026-10-21'))
    expect(segment[1].y).toBeCloseTo(weightOn('2026-10-21'))
    expect(goal.target_date).toBe('2027-01-01')
  })

  it('keeps the original slope when the start is clipped to the selected period', () => {
    const segment = visibleGoalSegment(goal, '2026-10-26', '2026-11-05')!
    expect(segment[0].x).toBe(timestamp('2026-10-26'))
    expect(segment[0].y).toBeCloseTo(weightOn('2026-10-26'))
    expect(segment[1].x).toBe(timestamp('2026-11-05'))
    expect(segment[1].y).toBeCloseTo(weightOn('2026-11-05'))
    expect((segment[1].y - segment[0].y) / dayCount('2026-10-26', '2026-11-05')).toBeCloseTo(-5.5 / 102)
  })

  it('stops at an earlier target date and lands exactly on the target weight', () => {
    const segment = visibleGoalSegment(goal, undefined, '2027-01-21')!
    expect(segment[1]).toEqual({ x: timestamp('2027-01-01'), y: 96 })
  })

  it('stops at a target date inside a short preview', () => {
    const nearGoal: WeightGoal = { ...goal, start_date: '2026-09-10', target_date: '2026-09-21' }
    const segment = visibleGoalSegment(nearGoal, '2026-09-13', '2026-09-22')!
    expect(segment[1]).toEqual({ x: timestamp('2026-09-21'), y: 96 })
  })

  it('keeps a goal that starts inside the preview after the selected period', () => {
    const laterGoal: WeightGoal = { ...goal, start_date: '2026-09-21', target_date: '2026-10-21' }
    const segment = visibleGoalSegment(laterGoal, '2026-09-13', '2026-09-22')!
    expect(segment[0]).toEqual({ x: timestamp('2026-09-21'), y: 101.5 })
    expect(segment[1].x).toBe(timestamp('2026-09-22'))
  })

  it('omits paths that start at or after the preview end or finish before the selected period', () => {
    expect(visibleGoalSegment(goal, undefined, '2026-09-21')).toBeUndefined()
    expect(visibleGoalSegment(goal, undefined, '2026-07-01')).toBeUndefined()
    expect(visibleGoalSegment(goal, '2027-02-01', '2027-03-01')).toBeUndefined()
  })

  it.each<[string, WeightGoal]>([
    ['an undated goal', { ...goal, target_date: null, plan: null }],
    ['a dated goal without a starting weight', { ...goal, baseline_weight_kg: null, plan: null }],
    ['a goal without a plan', { ...goal, plan: null }],
  ])('has no slanted path for %s', (_name, candidate) => {
    expect(visibleGoalSegment(candidate, undefined, '2026-10-21')).toBeUndefined()
  })

  it('includes the clipped endpoint in the axis ticks without overshooting it', () => {
    const axis = chartTimeAxis([timestamp('2026-09-01'), timestamp('2026-09-21'), timestamp('2026-10-21')])
    expect(axis.domain).toEqual([timestamp('2026-09-01'), timestamp('2026-10-21')])
    expect(axis.ticks.at(-1)).toBe(axis.domain[1])
    expect(axis.ticks.every((tick) => tick >= axis.domain[0] && tick <= axis.domain[1])).toBe(true)
  })
})

describe('goal window notice', () => {
  it('stays silent while the planned path is visible', () => {
    expect(goalWindowNotice(goal, undefined, '2026-10-21')).toBeUndefined()
    expect(goalWindowNotice(goal, '2026-10-26', '2026-11-05')).toBeUndefined()
  })

  it('reports a path that only begins after the preview end', () => {
    expect(goalWindowNotice(goal, undefined, '2026-09-21')).toBe('starts-later')
    expect(goalWindowNotice(goal, undefined, '2026-07-01')).toBe('starts-later')
  })

  it('reports a path that finished before the selected period', () => {
    expect(goalWindowNotice(goal, '2027-02-01', '2027-03-01')).toBe('ended-earlier')
    expect(goalWindowNotice(goal, '2027-01-01', '2027-02-01')).toBe('ended-earlier')
  })

  it('reports a dated plan without usable numbers instead of staying blank', () => {
    expect(goalWindowNotice({ ...goal, baseline_weight_kg: null }, undefined, '2026-10-21')).toBe('unavailable')
    expect(goalWindowNotice({ ...goal, start_date: '2026-09-21', target_date: '2026-09-21' }, '2026-09-01', '2026-10-21')).toBe('unavailable')
  })

  it.each<[string, WeightGoal]>([
    ['an undated goal', { ...goal, target_date: null, plan: null }],
    ['a goal without a plan', { ...goal, plan: null }],
  ])('leaves the flat-target fallback for %s unexplained', (_name, candidate) => {
    expect(goalWindowNotice(candidate, undefined, '2026-10-21')).toBeUndefined()
  })
})
