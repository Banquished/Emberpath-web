import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeightGoal } from '@/entities/weight-goal'
import { WeightChart } from './weight-chart'

vi.mock('../api/weight-logs', () => ({ useWeightRollingAverage: () => ({ isSuccess: true, data: { points: [] } }) }))
const goal: WeightGoal = { id: 'goal', status: 'active', start_date: '2026-09-21', target_date: '2027-01-01', baseline_weight_kg: 101.5, target_weight_kg: 96, plan: { duration_days: 102, total_change_kg: -5.5, weekly_change_kg: -0.38, fortnightly_change_kg: -0.75 }, created_at: '', ended_at: null }
const entries = [{ id: 'one', date: '2026-09-01', weight_kg: 100 }, { id: 'two', date: '2026-09-21', weight_kg: 101.5 }]
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-21T12:00:00'))
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe(target: Element) { this.callback([{ target, contentRect: { width: 800, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => vi.useRealTimers())

describe('goal chart visibility', () => {
  it('toggles the path and its future axis extension together', async () => {
    const { container } = render(<WeightChart entries={entries} goal={goal} />)
    await waitFor(() => expect(container.querySelector('.recharts-reference-line-line')).toBeInTheDocument())
    expect(screen.getByText('21 Oct')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show goal' }))
    expect(container.querySelector('.recharts-reference-line-line')).not.toBeInTheDocument()
    expect(screen.queryByText('21 Oct')).not.toBeInTheDocument()
    expect(screen.queryByText(/one calendar month ahead/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show goal' }))
    await waitFor(() => expect(container.querySelector('.recharts-reference-line-line')).toBeInTheDocument())
  })
  it('toggles an undated flat target', async () => {
    const { container } = render(<WeightChart entries={entries} goal={{ ...goal, target_date: null, plan: null }} />)
    await waitFor(() => expect(container.querySelector('.recharts-reference-line-line')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show goal' }))
    expect(container.querySelector('.recharts-reference-line-line')).not.toBeInTheDocument()
  })
  it('does not show a flat target when a dated plan starts outside the preview window', () => {
    const { container } = render(<WeightChart entries={entries} goal={{ ...goal, start_date: '2026-12-01' }} />)
    expect(container.querySelector('.recharts-reference-line-line')).not.toBeInTheDocument()
    expect(screen.queryByText(/Current target:/)).not.toBeInTheDocument()
  })
  it('can show a bounded planned path with no measurements', async () => {
    const { container } = render(<WeightChart entries={[]} goal={goal} />)
    await waitFor(() => expect(container.querySelector('.recharts-reference-line-line')).toBeInTheDocument())
    expect(screen.getByText('21 Oct')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show goal' }))
    expect(screen.getByText('No measurements in this period.')).toBeInTheDocument()
  })
})
