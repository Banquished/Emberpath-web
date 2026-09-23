import { describe, expect, it } from 'vitest'
import type { WeightGoal } from '@/entities/weight-goal'
import { chartTimeAxis, goalPreviewEnd, visibleGoalSegment } from './weight-chart-window'

const goal: WeightGoal = { id: 'goal', status: 'active', start_date: '2026-09-21', target_date: '2027-01-01', baseline_weight_kg: 101.5, target_weight_kg: 96, plan: { duration_days: 102, total_change_kg: -5.5, weekly_change_kg: -0.38, fortnightly_change_kg: -0.75 }, created_at: '', ended_at: null }
const timestamp = (date: string) => new Date(`${date}T12:00:00`).getTime()

describe('goal preview window', () => {
  it.each([['2026-01-31', '2026-02-28'], ['2028-01-31', '2028-02-29'], ['2026-12-31', '2027-01-31']])('clamps one calendar month after %s to %s', (today, expected) => {
    expect(goalPreviewEnd(new Date(`${today}T12:00:00`))).toBe(expected)
  })
  it('clips the future path without changing its original rate or deadline', () => {
    const segment = visibleGoalSegment(goal, undefined, new Date('2026-09-21T12:00:00'))!
    expect(segment[0]).toEqual({ x: timestamp('2026-09-21'), y: 101.5 })
    expect(segment[1].x).toBe(timestamp('2026-10-21'))
    expect(segment[1].y).toBeCloseTo(101.5 - 5.5 * 30 / 102)
    expect(goal.target_date).toBe('2027-01-01')
  })
  it('clips the beginning to the selected period and counts calendar days across DST', () => {
    const segment = visibleGoalSegment(goal, '2026-10-26', new Date('2026-11-01T12:00:00'))!
    expect(segment[0].x).toBe(timestamp('2026-10-26'))
    expect(segment[0].y).toBeCloseTo(101.5 - 5.5 * 35 / 102)
  })
  it('stops at an earlier target date', () => {
    const segment = visibleGoalSegment(goal, undefined, new Date('2026-12-21T12:00:00'))!
    expect(segment[1]).toEqual({ x: timestamp('2027-01-01'), y: 96 })
  })
  it('omits paths entirely outside the visible window', () => {
    expect(visibleGoalSegment(goal, undefined, new Date('2026-07-01T12:00:00'))).toBeUndefined()
    expect(visibleGoalSegment(goal, '2027-02-01', new Date('2027-03-01T12:00:00'))).toBeUndefined()
  })
  it('includes the clipped endpoint in the axis ticks without overshooting it', () => {
    const axis = chartTimeAxis([timestamp('2026-09-01'), timestamp('2026-09-21'), timestamp('2026-10-21')])
    expect(axis.domain).toEqual([timestamp('2026-09-01'), timestamp('2026-10-21')])
    expect(axis.ticks.at(-1)).toBe(axis.domain[1])
    expect(axis.ticks.every((tick) => tick >= axis.domain[0] && tick <= axis.domain[1])).toBe(true)
  })
})
