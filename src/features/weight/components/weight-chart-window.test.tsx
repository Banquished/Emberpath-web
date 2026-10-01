import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeightGoal } from '@/entities/weight-goal'
import { WeightChart } from './weight-chart'

const { useAverage } = vi.hoisted(() => ({ useAverage: vi.fn() }))
vi.mock('../api/weight-logs', () => ({ useWeightRollingAverage: (...args: unknown[]) => useAverage(...args) }))
const goal: WeightGoal = { id: 'goal', status: 'active', start_date: '2026-09-21', target_date: '2027-01-01', baseline_weight_kg: 101.5, target_weight_kg: 96, plan: { duration_days: 102, total_change_kg: -5.5, weekly_change_kg: -0.38, fortnightly_change_kg: -0.75 }, created_at: '', ended_at: null }
const entries = [{ id: 'one', date: '2026-09-01', weight_kg: 100 }, { id: 'two', date: '2026-09-21', weight_kg: 101.5 }]
const goalLine = (container: HTMLElement) => container.querySelector('.recharts-reference-line-line')
const axisLabels = (container: HTMLElement) => [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')].map((tick) => tick.textContent)
beforeEach(() => {
  useAverage.mockReturnValue({ isSuccess: true, data: { points: [] } })
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe(target: Element) { this.callback([{ target, contentRect: { width: 800, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => vi.clearAllMocks())

describe('goal path horizon on the chart', () => {
  it('extends the time axis to the preview end for a long deadline and draws the path', async () => {
    const { container } = render(<WeightChart entries={entries} goal={goal} previewEnd="2026-10-21" />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    expect(axisLabels(container).at(0)).toBe('1 Sept')
    expect(axisLabels(container).at(-1)).toBe('21 Oct')
    expect(screen.getAllByText('Planned path to 96 kg')).toHaveLength(2)
  })

  it.each([['2026-09-24', '24 Sept'], ['2026-10-16', '16 Oct'], ['2026-11-01', '1 Nov']])('ends the axis at a %s preview end', async (previewEnd, label) => {
    const { container } = render(<WeightChart entries={entries} goal={goal} previewEnd={previewEnd} />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    expect(axisLabels(container).at(-1)).toBe(label)
  })

  it('stops at an earlier goal deadline instead of the preview end', async () => {
    const { container } = render(<WeightChart entries={entries} goal={{ ...goal, target_date: '2026-10-05', plan: { ...goal.plan!, duration_days: 14 } }} previewEnd="2026-10-21" />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    expect(axisLabels(container).at(-1)).toBe('5 Oct')
    expect(axisLabels(container)).not.toContain('21 Oct')
  })

  it('toggles the path and its future axis extension together', async () => {
    const { container } = render(<WeightChart entries={entries} goal={goal} previewEnd="2026-10-21" />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    expect(axisLabels(container).at(-1)).toBe('21 Oct')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show goal' }))
    expect(goalLine(container)).not.toBeInTheDocument()
    expect(axisLabels(container)).not.toContain('21 Oct')
    expect(axisLabels(container).at(-1)).toBe('21 Sept')
    expect(screen.queryByText(/Planned path to/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show goal' }))
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    expect(axisLabels(container).at(-1)).toBe('21 Oct')
  })

  it('does not extend the axis or claim a path when there is no goal', async () => {
    const { container } = render(<WeightChart entries={entries} goal={null} previewEnd="2026-10-21" />)
    await waitFor(() => expect(container.querySelector('.recharts-line')).toBeInTheDocument())
    expect(axisLabels(container).at(-1)).toBe('21 Sept')
    expect(goalLine(container)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Show goal' })).not.toBeInTheDocument()
  })
})

describe('goal fallbacks on the chart', () => {
  it('draws an undated target as a flat line without extending the axis', async () => {
    const { container } = render(<WeightChart entries={entries} goal={{ ...goal, target_date: null, plan: null }} previewEnd="2026-10-21" />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    expect(goalLine(container)!.getAttribute('y1')).toBe(goalLine(container)!.getAttribute('y2'))
    expect(axisLabels(container).at(-1)).toBe('21 Sept')
    expect(screen.getAllByText('Current target: 96 kg')).toHaveLength(2)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show goal' }))
    expect(goalLine(container)).not.toBeInTheDocument()
  })

  it('falls back to a flat target for a dated goal without a plan, and never invents a slope', async () => {
    const { container } = render(<WeightChart entries={entries} goal={{ ...goal, plan: null, baseline_weight_kg: null }} previewEnd="2026-10-21" />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    expect(goalLine(container)!.getAttribute('y1')).toBe(goalLine(container)!.getAttribute('y2'))
    expect(axisLabels(container).at(-1)).toBe('21 Sept')
    expect(screen.getAllByText('Current target: 96 kg')).toHaveLength(2)
  })

  it.each([
    ['starts after the preview window', { ...goal, start_date: '2026-12-01' }, undefined, 'Your goal’s planned path starts after the dates shown here, so there is nothing to draw yet.'],
    ['ended before the selected period', { ...goal, start_date: '2026-08-01', target_date: '2026-09-05' }, '2026-09-10', 'Your goal’s planned path ended before this period. Choose a longer period to see it.'],
  ] as const)('explains rather than draws a dated plan that %s', (_name, outside, start, explanation) => {
    const { container } = render(<WeightChart entries={entries} goal={outside} start={start} previewEnd="2026-10-21" />)
    expect(screen.getByRole('checkbox', { name: 'Show goal' })).toBeChecked()
    expect(screen.getByText(explanation)).toBeVisible()
    expect(goalLine(container)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show goal' }))
    expect(screen.queryByText(explanation)).not.toBeInTheDocument()
    expect(axisLabels(container).at(-1)).toBe('21 Sept')
  })

  it('explains an off-window goal beside an empty chart', () => {
    render(<WeightChart entries={[]} goal={{ ...goal, start_date: '2026-12-01' }} previewEnd="2026-10-21" />)
    expect(screen.getByText('No measurements in this period.')).toBeInTheDocument()
    expect(screen.getByText('Your goal’s planned path starts after the dates shown here, so there is nothing to draw yet.')).toBeVisible()
  })

  it('explains a dated plan whose starting weight is missing instead of showing nothing', () => {
    const { container } = render(<WeightChart entries={entries} goal={{ ...goal, baseline_weight_kg: null }} previewEnd="2026-10-21" />)
    expect(screen.getByText('A planned path is not available for this goal.')).toBeVisible()
    expect(goalLine(container)).not.toBeInTheDocument()
    expect(screen.queryByText(/Current target:/)).not.toBeInTheDocument()
  })

  it('stays quiet about the window while the planned path is drawn', async () => {
    const { container } = render(<WeightChart entries={entries} goal={goal} previewEnd="2026-10-21" />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    expect(screen.queryByText(/planned path starts after/)).not.toBeInTheDocument()
    expect(screen.queryByText(/planned path ended before/)).not.toBeInTheDocument()
    expect(screen.queryByText(/not available for this goal/)).not.toBeInTheDocument()
  })

  it.each([
    ['starts after the preview window', { ...goal, start_date: '2026-12-01' }, undefined],
    ['ended before the selected period', { ...goal, start_date: '2026-08-01', target_date: '2026-09-05' }, '2026-09-10'],
  ] as const)('does not turn a dated plan that %s into a flat prediction', (_name, outside, start) => {
    const { container } = render(<WeightChart entries={entries} goal={outside} start={start} previewEnd="2026-10-21" />)
    expect(goalLine(container)).not.toBeInTheDocument()
    expect(screen.queryByText(/Current target:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Planned path to/)).not.toBeInTheDocument()
    expect(axisLabels(container).at(-1)).toBe('21 Sept')
  })

  it('can show a bounded planned path with no measurements', async () => {
    const { container } = render(<WeightChart entries={[]} goal={goal} previewEnd="2026-10-21" />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    expect(axisLabels(container).at(-1)).toBe('21 Oct')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show goal' }))
    expect(screen.getByText('No measurements in this period.')).toBeInTheDocument()
    expect(goalLine(container)).not.toBeInTheDocument()
  })

  it('shows a target outside the measured range with an explicit current-target label', async () => {
    const { container } = render(<WeightChart goal={{ ...goal, target_date: null, plan: null, target_weight_kg: 75 }} entries={[{ id: 'entry-1', date: '2026-09-01', weight_kg: 100 }]} previewEnd="2026-10-21" />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    const line = goalLine(container)!
    expect(Number(line.getAttribute('y1'))).toBeGreaterThanOrEqual(0)
    expect(Number(line.getAttribute('y1'))).toBeLessThanOrEqual(300)
    expect(screen.getAllByText('Current target: 75 kg')).toHaveLength(2)
    expect(line).toHaveAttribute('stroke', 'var(--ep-semantic-chart-target)')
  })

  it.each([true, false])('renders a sloping planned segment that ends at the deadline, with measurements: %s', async (hasMeasurements) => {
    const sloped: WeightGoal = { ...goal, start_date: '2026-09-01', target_weight_kg: 75, baseline_weight_kg: 80, target_date: '2026-10-11', plan: { duration_days: 40, total_change_kg: -5, weekly_change_kg: -0.88, fortnightly_change_kg: -1.75 } }
    const { container } = render(<WeightChart goal={sloped} start="2026-09-01" end="2026-09-20" previewEnd="2026-10-20" entries={hasMeasurements ? [{ id: 'entry-1', date: '2026-09-15', weight_kg: 79 }] : []} />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    const line = goalLine(container)!
    expect(Number(line.getAttribute('x2'))).toBeGreaterThan(Number(line.getAttribute('x1')))
    expect(Number(line.getAttribute('y2'))).toBeGreaterThan(Number(line.getAttribute('y1')))
    expect(Number(line.getAttribute('y2'))).toBeLessThanOrEqual(300)
    expect(screen.getAllByText('Planned path to 75 kg')).toHaveLength(2)
    expect(axisLabels(container).at(-1)).toBe('11 Oct')
    expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(hasMeasurements ? 1 : 0)
  })
})

describe('chart explanations and accessibility', () => {
  it('describes the chart to assistive technology and keeps it keyboard inspectable', async () => {
    const { container } = render(<WeightChart entries={entries} goal={goal} previewEnd="2026-10-21" />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    const surface = container.querySelector<SVGElement>('svg.recharts-surface')!
    expect(surface).toHaveAttribute('tabindex', '0')
    expect(surface).toHaveAttribute('role', 'application')
    const description = document.getElementById(surface.getAttribute('aria-describedby')!)
    expect(description).toHaveTextContent('Line chart of daily weight in kilograms for the selected period, with a 7-day average and your goal.')
    expect(description).toHaveTextContent('Exact values are in the History tab.')
    expect(surface).toHaveAccessibleName('Daily weight measurements')
  })

  it('keeps a compact legend and moves the long explanations behind a click or tap', async () => {
    const user = userEvent.setup()
    const { container } = render(<WeightChart entries={entries} goal={goal} previewEnd="2026-10-21" />)
    await waitFor(() => expect(goalLine(container)).toBeInTheDocument())
    const legend = screen.getByLabelText('Chart legend')
    expect(legend).toHaveTextContent('Weight (kg)')
    expect(legend).toHaveTextContent('7-day average')
    expect(legend).toHaveTextContent('Planned path to 96 kg')
    const toggle = screen.getByRole('button', { name: 'About this chart' })
    expect(screen.getByText(/Gray dashed lines connect measurements/)).not.toBeVisible()
    await user.click(toggle)
    expect(screen.getByText(/Gray dashed lines connect measurements across unrecorded days/)).toBeVisible()
    expect(screen.getByText(/The 7-day average uses available measurements from that day and the previous 6 days, including days before the selected period/)).toBeVisible()
    expect(screen.getByText(/use the arrow keys on the chart to inspect a day\. Exact values are in the History tab\./)).toBeVisible()
    expect(screen.getByText(/half of the selected range for the last week, 2 weeks or month, and one calendar month for longer ranges/)).toHaveTextContent(/It is a plan, not a prediction\..*never goes past your target date/)
    expect(screen.queryByText(/Measurements are also listed below/)).not.toBeInTheDocument()
  })

  it('explains the flat target as a target rather than a prediction', async () => {
    const user = userEvent.setup()
    render(<WeightChart entries={entries} goal={{ ...goal, target_date: null, plan: null }} previewEnd="2026-10-21" />)
    await user.click(screen.getByRole('button', { name: 'About this chart' }))
    expect(screen.getByText('The dotted line marks your current target weight. It is not a prediction.')).toBeVisible()
    expect(screen.queryByText(/The planned path uses/)).not.toBeInTheDocument()
  })

  it('follows the rolling-average choice in the request, legend and explanation', async () => {
    const user = userEvent.setup()
    render(<WeightChart entries={entries} goal={null} start="2026-09-01" end="2026-09-21" previewEnd="2026-10-21" />)
    expect(useAverage).toHaveBeenLastCalledWith('2026-09-01', '2026-09-21', 7)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rolling average' }), '14')
    expect(useAverage).toHaveBeenLastCalledWith('2026-09-01', '2026-09-21', 14)
    expect(screen.getByLabelText('Chart legend')).toHaveTextContent('14-day average')
    await user.click(screen.getByRole('button', { name: 'About this chart' }))
    expect(screen.getByText(/The 14-day average uses available measurements from that day and the previous 13 days/)).toBeVisible()
  })

  it('keeps a visible message and retry when the average cannot be loaded', async () => {
    const refetch = vi.fn()
    useAverage.mockReturnValue({ isSuccess: false, isPending: false, isError: true, error: new Error('Try again later.'), isFetching: false, refetch })
    const user = userEvent.setup()
    render(<WeightChart entries={entries} goal={null} previewEnd="2026-10-21" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the 7-day average. Try again later.')
    expect(screen.getByLabelText('Chart legend')).not.toHaveTextContent('7-day average')
    await user.click(screen.getByRole('button', { name: 'Retry average' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
