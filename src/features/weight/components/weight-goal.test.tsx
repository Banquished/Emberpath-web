import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeightGoal } from '@/entities/weight-goal'
import { WeightGoalPanel } from './weight-goal'
import { WeightChart } from './weight-chart'

vi.mock('@clerk/react', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'session-a', getToken: async () => 'test-token' }) }))
const sample: WeightGoal = { id: 'goal-1', baseline_weight_kg: null, plan: null, target_weight_kg: 75, start_date: '2026-09-01', target_date: null, status: 'active', created_at: '2026-09-01T12:00:00Z', ended_at: null }
afterEach(() => vi.useRealTimers())
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-20T12:00:00'))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe(target: Element) { this.callback([{ target, contentRect: { width: 800, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve() {}
    disconnect() {}
  })
})
function setup(initial: WeightGoal | null = null) {
  let goal = initial
  let fail = false
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/rolling-average')) return Response.json({ window_days: 7, points: [] })
    if (fail) return Response.json({}, { status: 500 })
    if (options?.method === 'PUT') { goal = { ...sample, ...JSON.parse(options.body as string) }; return Response.json(goal) }
    if (options?.method === 'PATCH') { const ended = { ...goal, ...JSON.parse(options.body as string) }; goal = null; return Response.json(ended) }
    return Response.json(goal)
  })
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><WeightGoalPanel /></QueryClientProvider>)
  return { fetchMock, client, view, fail: () => { fail = true } }
}

describe('personal weight goal', () => {
  it('creates a goal with an optional date and refreshes the scoped active goal', async () => {
    const { fetchMock, client } = setup()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Set goal' }))
    expect(screen.getByLabelText('Target weight (kg)')).toHaveFocus()
    await user.type(screen.getByLabelText('Target weight (kg)'), '75.25')
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Target date (optional)'), { target: { value: '2027-01-01' } })
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    expect(await screen.findByText('75.25 kg')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')!
    expect(JSON.parse(call[1]!.body as string)).toEqual({ target_weight_kg: 75.25, start_date: '2026-09-01', target_date: '2027-01-01', baseline_weight_kg: null })
    expect(new Headers(call[1]!.headers).get('Authorization')).toBe('Bearer test-token')
    expect(client.getQueryData(['weight-goals', 'user-a', 'session-a'])).toMatchObject({ target_weight_kg: 75.25 })
  })
  it('replaces the target with an explicit history explanation and allows no target date', async () => {
    const { fetchMock } = setup(sample)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Change goal' }))
    expect(screen.getByText(/replaces your current goal/)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Target weight (kg)'))
    await user.type(screen.getByLabelText('Target weight (kg)'), '80')
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    expect(await screen.findByText('80 kg')).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')!
    expect(JSON.parse(call[1]!.body as string).target_date).toBeNull()
  })
  it.each([['Mark completed', 'completed'], ['Cancel goal', 'cancelled']] as const)('confirms %s and removes the active target', async (label, status) => {
    const { fetchMock } = setup(sample)
    const user = userEvent.setup()
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
    await user.click(await screen.findByRole('button', { name: label }))
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: label }))
    expect(await screen.findByRole('button', { name: 'Set goal' })).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH')!
    expect(call[0]).toContain('/weight-goals/goal-1')
    expect(JSON.parse(call[1]!.body as string)).toEqual({ status })
  })
  it('keeps the editor and entered value when saving fails', async () => {
    const service = setup(sample)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Change goal' }))
    service.fail()
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not update your goal')
    expect(screen.getByLabelText('Target weight (kg)')).toHaveValue(75)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it('shows a target outside the measured range with an explicit current-target label', async () => {
    const { client, view } = setup()
    view.unmount()
    const { container } = render(<QueryClientProvider client={client}><WeightChart goal={sample} entries={[{ id: 'entry-1', date: '2026-09-01', weight_kg: 100 }]} /></QueryClientProvider>)
    await waitFor(() => expect(container.querySelector('.recharts-reference-line-line')).toBeInTheDocument())
    const line = container.querySelector('.recharts-reference-line-line')!
    expect(Number(line.getAttribute('y1'))).toBeGreaterThanOrEqual(0)
    expect(Number(line.getAttribute('y1'))).toBeLessThanOrEqual(300)
    expect(screen.getAllByText('Current target: 75 kg')).toHaveLength(2)
    expect(line).toHaveAttribute('stroke', 'var(--ep-semantic-chart-target)')
  })
  it('preserves a saved baseline and shows the pace supplied by the service', async () => {
    const goal: WeightGoal = { ...sample, baseline_weight_kg: 80, target_date: '2026-10-11', plan: { duration_days: 40, total_change_kg: -5, weekly_change_kg: -0.88, fortnightly_change_kg: -1.75 } }
    const { fetchMock } = setup(goal)
    expect(await screen.findByText(/Planned pace: -0.88 kg\/week/)).toHaveTextContent('-1.75 kg/fortnight')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Change goal' }))
    expect(screen.getByLabelText('Starting weight (kg, optional)')).toHaveValue(80)
    expect(screen.getByLabelText('Target date (optional)')).toHaveAttribute('min', '2026-09-02')
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true))
    const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')!
    expect(JSON.parse(call[1]!.body as string).baseline_weight_kg).toBe(80)
  })
  it('accepts a manual starting weight for a new dated goal', async () => {
    const { fetchMock } = setup()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Set goal' }))
    await user.type(screen.getByLabelText('Target weight (kg)'), '75')
    await user.type(screen.getByLabelText('Starting weight (kg, optional)'), '80.5')
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Target date (optional)'), { target: { value: '2026-11-01' } })
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true))
    const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')!
    expect(JSON.parse(call[1]!.body as string).baseline_weight_kg).toBe(80.5)
  })
  it.each([true, false])('renders a sloping planned segment, including future dates (has measurements: %s)', async (hasMeasurements) => {
    const { client, view } = setup()
    view.unmount()
    const goal: WeightGoal = { ...sample, baseline_weight_kg: 80, target_date: '2026-10-11', plan: { duration_days: 40, total_change_kg: -5, weekly_change_kg: -0.88, fortnightly_change_kg: -1.75 } }
    const { container } = render(<QueryClientProvider client={client}><WeightChart goal={goal} start="2026-09-01" end="2026-09-20" entries={hasMeasurements ? [{ id: 'entry-1', date: '2026-09-15', weight_kg: 79 }] : []} /></QueryClientProvider>)
    await waitFor(() => expect(container.querySelector('.recharts-reference-line-line')).toBeInTheDocument())
    const line = container.querySelector('.recharts-reference-line-line')!
    expect(Number(line.getAttribute('x2'))).toBeGreaterThan(Number(line.getAttribute('x1')))
    expect(Number(line.getAttribute('y2'))).toBeGreaterThan(Number(line.getAttribute('y1')))
    expect(Number(line.getAttribute('y2'))).toBeLessThanOrEqual(300)
    expect(screen.getAllByText('Planned path to 75 kg')).toHaveLength(2)
    expect(screen.getByText(/one calendar month ahead/)).toHaveTextContent('not a prediction')
    expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(hasMeasurements ? 1 : 0)
  })

})
