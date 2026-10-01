import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeightGoal } from '@/entities/weight-goal'
import type { WeightLog, WeightLogInput } from '@/entities/weight-log'
import { WeightPage } from './weight-page'
import './weight-chart'

vi.mock('@clerk/react', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'session-a', getToken: async () => 'test-token' }) }))

const sample: WeightLog = { id: '083c82c3-f14c-429a-a89c-62f79c994be7', date: '2026-09-16', weight_kg: 82.5 }
const plannedGoal: WeightGoal = { id: 'goal-1', baseline_weight_kg: 83, plan: { duration_days: 150, total_change_kg: -5, weekly_change_kg: -0.23, fortnightly_change_kg: -0.47 }, target_weight_kg: 78, start_date: '2026-09-01', target_date: '2027-01-29', status: 'active', created_at: '2026-09-01T12:00:00Z', ended_at: null }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 19, 12))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 800, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => { vi.useRealTimers() })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><WeightPage /></QueryClientProvider>)
}

function mockService(initial: WeightLog[] = [], initialGoal: WeightGoal | null = null) {
  let entries = [...initial]
  let goal = initialGoal
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/weight-goals')) {
      if (options?.method === 'PUT') goal = { ...plannedGoal, ...JSON.parse(options.body as string) as Partial<WeightGoal> }
      if (options?.method === 'PATCH' && goal) {
        const ended: WeightGoal = { ...goal, status: (JSON.parse(options.body as string) as Pick<WeightGoal, 'status'>).status, ended_at: '2026-09-19T12:00:00Z' }
        goal = null
        return Response.json(ended)
      }
      return Response.json(goal)
    }
    if (url.includes('/rolling-average')) return Response.json({ window_days: Number(new URL(url, 'http://localhost').searchParams.get('window_days') ?? 7), points: entries.map((entry) => ({ date: entry.date, mean_weight_kg: entry.weight_kg, measurement_count: 1 })) })
    if (url.includes('/summary')) {
      const params = new URL(url, 'http://localhost').searchParams
      const filtered = entries.filter((entry) => (!params.get('start_date') || entry.date >= params.get('start_date')!) && (!params.get('end_date') || entry.date <= params.get('end_date')!)).sort((a, b) => a.date.localeCompare(b.date))
      const first = filtered[0] ?? null
      const latest = filtered.at(-1) ?? null
      const change = filtered.length > 1 ? latest!.weight_kg - first!.weight_kg : null
      return Response.json({ measurement_count: filtered.length, mean_weight_kg: filtered.length ? filtered.reduce((total, entry) => total + entry.weight_kg, 0) / filtered.length : null, first, latest, change_kg: change, change_percent: change === null ? null : change / first!.weight_kg * 100 })
    }
    if (options?.method === 'POST') {
      const input = JSON.parse(options.body as string) as WeightLogInput
      if (entries.some((entry) => entry.date === input.date)) return Response.json({ detail: 'Duplicate date' }, { status: 409 })
      const entry = { id: `new-${input.date}`, ...input }
      entries = [entry, ...entries]
      return Response.json(entry, { status: 201 })
    }
    if (options?.method === 'PATCH') {
      const id = url.split('/').at(-1)
      const entry = { ...entries.find((item) => item.id === id)!, ...JSON.parse(options.body as string) as WeightLogInput }
      entries = entries.map((item) => item.id === id ? entry : item)
      return Response.json(entry)
    }
    if (options?.method === 'DELETE') {
      entries = entries.filter((entry) => entry.id !== url.split('/').at(-1))
      return new Response(null, { status: 204 })
    }
    return Response.json(entries)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function dailyEntries(count: number): WeightLog[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(2026, 8, 19 - index, 12)
    return { id: `entry-${index}`, date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, weight_kg: 82 + index / 10 }
  })
}

function historyRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1)
}

type User = ReturnType<typeof userEvent.setup>

async function openHistory(user: User) {
  await user.click(await screen.findByRole('tab', { name: 'History' }))
}

async function openChart(user: User) {
  await user.click(await screen.findByRole('tab', { name: 'Chart' }))
}

async function openActions(user: User, date = '16 Sept 2026') {
  await openHistory(user)
  await user.click(await screen.findByLabelText(`Actions for ${date}`))
}

type FetchMock = ReturnType<typeof mockService>

const axisLabels = (container: HTMLElement) => [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')].map((tick) => tick.textContent)

const isListRead = (url: string, options?: RequestInit) => url === '/api/weight-logs' && !options?.method
const isSummaryRead = (url: string) => url.includes('/summary')
const isAverageRead = (url: string) => url.includes('/rolling-average')

function requests(fetchMock: FetchMock, matches: (url: string, options?: RequestInit) => boolean) {
  return fetchMock.mock.calls.filter(([url, options]) => matches(url, options))
}

// The stored measurement is correct; only the save response disagrees, so any value shown from it is detectable.
function acknowledgeWrongly(fetchMock: FetchMock) {
  const service = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, options) => {
    const response = await service(url, options)
    return url.startsWith('/api/weight-logs') && (options?.method === 'POST' || options?.method === 'PATCH')
      ? Response.json({ id: 'acknowledged', date: '2026-09-01', weight_kg: 99 }, { status: response.status })
      : response
  })
}

describe('weight journal', () => {
  it('creates a measurement from the dialog and refreshes the history', async () => {
    const fetchMock = mockService()
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('No measurements yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    expect(screen.getByRole('dialog', { name: 'Log your weight' })).toBeInTheDocument()
    expect(screen.getByLabelText('Date')).toHaveValue('2026-09-19')
    expect(screen.getByLabelText('Weight (kg)')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: sample.date } })
    await user.type(screen.getByLabelText('Weight (kg)'), '82.5')
    await user.click(screen.getByRole('button', { name: 'Save weight' }))
    expect(await screen.findByText('Measurement saved.')).toBeInTheDocument()
    await openHistory(user)
    expect(within(screen.getByRole('table')).getByText('82.5')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('No measurements yet')).not.toBeInTheDocument()
    expect(await within(screen.getByRole('region', { name: 'Weight summary' })).findByText('Add another measurement')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/weight-logs', expect.objectContaining({ method: 'POST', body: JSON.stringify({ date: sample.date, weight_kg: 82.5 }) }))
  })

  it('edits the weight and date, then closes the dialog after saving', async () => {
    const fetchMock = mockService([sample])
    const user = userEvent.setup()
    renderPage()
    await openActions(user)
    await user.click(screen.getByRole('button', { name: 'Edit measurement for 16 Sept 2026' }))
    expect(screen.getByLabelText('Weight (kg)')).toHaveFocus()
    await user.clear(screen.getByLabelText('Weight (kg)'))
    await user.type(screen.getByLabelText('Weight (kg)'), '81.25')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-15' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Measurement updated.')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('81.25')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('15 Sept 2026')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Weight summary' })).getAllByText('81.25 kg')).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledWith(`/api/weight-logs/${sample.id}`, expect.objectContaining({ method: 'PATCH' }))
  })

  it('requires confirmation before deleting and handles the empty 204 response', async () => {
    const fetchMock = mockService([sample])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    renderPage()
    await openActions(user)
    await user.click(screen.getByRole('button', { name: 'Delete measurement for 16 Sept 2026' }))
    expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }))
    confirm.mockReturnValue(true)
    await openActions(user)
    await user.click(screen.getByRole('button', { name: 'Delete measurement for 16 Sept 2026' }))
    expect(await screen.findByText('Measurement deleted.')).toBeInTheDocument()
    expect(screen.getByText('No measurements yet')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Weight summary' })).getByText('0')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/weight-logs/${sample.id}`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('preserves dialog input when the date already has a measurement', async () => {
    mockService([sample])
    const user = userEvent.setup()
    renderPage()
    await openHistory(user)
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: sample.date } })
    await user.type(screen.getByLabelText('Weight (kg)'), '83')
    await user.click(screen.getByRole('button', { name: 'Save weight' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A measurement already exists for this date')
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue(83)
    expect(within(screen.getByRole('table')).getByText('82.5')).toBeInTheDocument()
  })

  it('keeps the edit dialog open on a duplicate-date PATCH', async () => {
    const fetchMock = mockService([sample])
    const service = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, options) => options?.method === 'PATCH'
      ? Promise.resolve(Response.json({ detail: 'Internal validation detail' }, { status: 409 }))
      : service(url, options))
    const user = userEvent.setup()
    renderPage()
    await openActions(user)
    await user.click(screen.getByRole('button', { name: 'Edit measurement for 16 Sept 2026' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A measurement already exists for this date')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Date')).toHaveValue(sample.date)
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue(sample.weight_kg)
    expect(screen.getByRole('alert')).not.toHaveTextContent('Internal validation detail')
  })

  it('does not mistake a history 422 for a period validation error', async () => {
    const fetchMock = mockService()
    const service = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, options) => url === '/api/weight-logs' && !options?.method
      ? Promise.resolve(Response.json({ detail: 'Internal validation detail' }, { status: 422 }))
      : service(url, options))
    renderPage()
    expect((await screen.findAllByRole('alert')).some((alert) => alert.textContent?.includes('could not complete the request'))).toBe(true)
    expect(screen.queryByText('No measurements yet')).not.toBeInTheDocument()
    expect(screen.queryByText(/Internal validation detail/)).not.toBeInTheDocument()
  })

  it('does not treat an empty save response as a saved measurement', async () => {
    const fetchMock = mockService()
    const service = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, options) => options?.method === 'POST'
      ? Promise.resolve(new Response(null, { status: 204 }))
      : service(url, options))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('No measurements yet')
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    await user.type(screen.getByLabelText('Weight (kg)'), '81')
    await user.click(screen.getByRole('button', { name: 'Save weight' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not complete the request')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('Measurement saved.')).not.toBeInTheDocument()
  })

  it('shows service errors separately from an empty history and can retry', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network error'))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPage()
    expect((await screen.findAllByRole('alert')).some((alert) => alert.textContent?.includes('Cannot reach the weight service'))).toBe(true)
    expect(screen.queryByText('No measurements yet')).not.toBeInTheDocument()
    fetchMock.mockImplementation(() => Promise.resolve(Response.json([])))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No measurements yet')).toBeInTheDocument()
  })

  it('does not label a read conflict as a duplicate date', async () => {
    const fetchMock = mockService()
    const service = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, options) => url === '/api/weight-logs' && !options?.method
      ? Promise.resolve(new Response(null, { status: 409 }))
      : service(url, options))
    renderPage()
    expect((await screen.findAllByRole('alert')).some((alert) => alert.textContent?.includes('could not complete the request'))).toBe(true)
    expect(screen.queryByText('No measurements yet')).not.toBeInTheDocument()
  })

  it('prevents invalid weights from being submitted', async () => {
    const fetchMock = mockService()
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('No measurements yet')
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    for (const weight of ['0', '-1', '82.123', '10000']) {
      await user.clear(screen.getByLabelText('Weight (kg)'))
      await user.type(screen.getByLabelText('Weight (kg)'), weight)
      await user.click(screen.getByRole('button', { name: 'Save weight' }))
      expect(screen.getByLabelText('Weight (kg)')).toBeInvalid()
    }
    expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }))
  })

  it('disables conflicting actions and cancellation while a save is pending', async () => {
    const fetchMock = mockService([sample])
    const user = userEvent.setup()
    renderPage()
    await openActions(user)
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    let complete!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve }))
    await user.type(screen.getByLabelText('Weight (kg)'), '81')
    await user.click(screen.getByRole('button', { name: 'Save weight' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit measurement for 16 Sept 2026' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText('Weight (kg)')).toBeDisabled()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    complete(Response.json({ detail: 'Duplicate date' }, { status: 409 }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save weight' })).toBeEnabled())
  })

  it('cancels without submitting and restores focus to the logging button', async () => {
    const fetchMock = mockService()
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('No measurements yet')
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    await user.type(screen.getByLabelText('Weight (kg)'), '81')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log weight' })).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }))
  })

  it('paginates 10, 25 and 50 rows without restricting the chart to the current page', async () => {
    mockService(dailyEntries(60))
    const user = userEvent.setup()
    const { container } = renderPage()
    await user.click(screen.getByRole('button', { name: 'All time' }))
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(60))
    await openHistory(user)
    expect(await screen.findByRole('table')).toBeVisible()
    expect(historyRows()).toHaveLength(10)
    expect(screen.getByText('Showing 1–10 of 60')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Showing 11–20 of 60')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).queryByText('19 Sept 2026')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Rows'), '25')
    expect(historyRows()).toHaveLength(25)
    expect(screen.getByText('Showing 1–25 of 60')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Rows'), '50')
    expect(historyRows()).toHaveLength(50)
    expect(screen.getByText('Showing 1–50 of 60')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(historyRows()).toHaveLength(10)
    expect(screen.getByText('Showing 51–60 of 60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await openChart(user)
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(60))
  })

  it('shares the period between chart and history and resets pagination', async () => {
    mockService(dailyEntries(60))
    const user = userEvent.setup()
    const { container } = renderPage()
    await user.click(screen.getByRole('button', { name: 'All time' }))
    await openHistory(user)
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Last week' }))
    expect(screen.getByText('Showing 1–7 of 7')).toBeInTheDocument()
    expect(historyRows()).toHaveLength(7)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await openChart(user)
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(7))
    await user.selectOptions(screen.getByLabelText('Period'), '2w')
    expect(screen.getByRole('button', { name: 'Last 2 weeks' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(14))
    await openHistory(user)
    expect(screen.getByText('Showing 1–10 of 14')).toBeInTheDocument()
  })

  it('clamps pagination when deleting the only row on the last page', async () => {
    mockService(dailyEntries(11))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderPage()
    await openHistory(user)
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Showing 11–11 of 11')).toBeInTheDocument()
    await openActions(user, '9 Sept 2026')
    await user.click(screen.getByRole('button', { name: 'Delete measurement for 9 Sept 2026' }))
    expect(await screen.findByText('Showing 1–10 of 10')).toBeInTheDocument()
    expect(historyRows()).toHaveLength(10)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})


describe('period summary', () => {
  it('explains a rejected date range without exposing service details', async () => {
    const fetchMock = mockService([sample])
    const service = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, options) => url.includes('/summary')
      ? Promise.resolve(Response.json({ detail: 'Internal validation detail' }, { status: 422 }))
      : service(url, options))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the selected date range and try again.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('rolling average window')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Internal validation detail')
    await openHistory(user)
    expect(await screen.findByRole('table')).toBeVisible()
  })

  it('uses authenticated inclusive bounds and updates the cards with the selected period', async () => {
    const fetchMock = mockService([{ ...sample, date: '2026-09-01', weight_kg: 90 }, { ...sample, id: 'latest', date: '2026-09-19', weight_kg: 80 }])
    const user = userEvent.setup()
    renderPage()
    const summary = screen.getByRole('region', { name: 'Weight summary' })
    expect(await within(summary).findByText('85 kg')).toBeInTheDocument()
    expect(within(summary).getByText('-10 kg')).toBeInTheDocument()
    expect(within(summary).getByText('-11.11% from first to latest')).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url]) => url.includes('/summary'))!
    expect(call[0]).toBe('/api/weight-logs/summary?start_date=2026-08-19&end_date=2026-09-19')
    expect(new Headers(call[1]?.headers).get('Authorization')).toBe('Bearer test-token')
    await user.click(screen.getByRole('button', { name: 'Last week' }))
    expect(await screen.findByText('Add another measurement')).toBeInTheDocument()
    expect(screen.queryByText('85 kg')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/weight-logs/summary?start_date=2026-09-13&end_date=2026-09-19', expect.anything())
    await user.click(screen.getByRole('button', { name: 'All time' }))
    expect(await screen.findByText('85 kg')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/weight-logs/summary', expect.anything())
  })

  it('shows empty values without implying zero weight or change', async () => {
    mockService()
    renderPage()
    const summary = screen.getByRole('region', { name: 'Weight summary' })
    expect(await within(summary).findByText('0')).toBeInTheDocument()
    expect(within(summary).getAllByText('\u2014')).toHaveLength(4)
    expect(within(summary).queryByText('0 kg')).not.toBeInTheDocument()
  })

  it('keeps history usable when summary fails and retries summary independently', async () => {
    const fetchMock = mockService([sample])
    const service = fetchMock.getMockImplementation()!
    let fail = true
    fetchMock.mockImplementation((url, options) => url.includes('/summary') && fail ? Promise.resolve(Response.json({}, { status: 500 })) : service(url, options))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the period summary')
    await openHistory(user)
    expect(await screen.findByRole('table')).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Retry summary' }))
    expect(await within(screen.getByRole('region', { name: 'Weight summary' })).findByText('Mean weight')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})


describe('rolling average', () => {
  it('explains rejected bounds or window without exposing service details', async () => {
    const fetchMock = mockService([sample])
    const service = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, options) => url.includes('/rolling-average')
      ? Promise.resolve(Response.json({ detail: 'Internal validation detail' }, { status: 422 }))
      : service(url, options))
    const { container } = renderPage()
    const user = userEvent.setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the selected date range or rolling average window and try again.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Internal validation detail')
    expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(1)
    await openHistory(user)
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('requests authenticated period bounds and refreshes when the period changes', async () => {
    const fetchMock = mockService([sample])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('7-day average')
    const call = fetchMock.mock.calls.find(([url]) => url.includes('/rolling-average'))!
    expect(call[0]).toBe('/api/weight-logs/rolling-average?start_date=2026-08-19&end_date=2026-09-19&window_days=7')
    expect(new Headers(call[1]?.headers).get('Authorization')).toBe('Bearer test-token')
    await user.click(screen.getByRole('button', { name: 'Last week' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/weight-logs/rolling-average?start_date=2026-09-13&end_date=2026-09-19&window_days=7', expect.anything()))
    await user.click(screen.getByRole('button', { name: 'All time' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/weight-logs/rolling-average?window_days=7', expect.anything()))
  })

  it('keeps recorded measurements visible when the average fails and retries independently', async () => {
    const fetchMock = mockService([sample])
    const service = fetchMock.getMockImplementation()!
    let fail = true
    fetchMock.mockImplementation((url, options) => url.includes('/rolling-average') && fail ? Promise.resolve(Response.json({}, { status: 500 })) : service(url, options))
    const user = userEvent.setup()
    const { container } = renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the 7-day average')
    expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(1)
    await openHistory(user)
    expect(screen.getByRole('table')).toBeInTheDocument()
    await openChart(user)
    fail = false
    await user.click(screen.getByRole('button', { name: 'Retry average' }))
    expect(await screen.findByText('7-day average')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('draws a distinct average without adding dots or filling unrecorded days', async () => {
    const fetchMock = mockService([sample, { ...sample, id: 'next', date: '2026-09-17', weight_kg: 81 }, { ...sample, id: 'later', date: '2026-09-19', weight_kg: 80 }])
    const service = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, options) => url.includes('/rolling-average') ? Promise.resolve(Response.json({ window_days: 7, points: [{ date: sample.date, mean_weight_kg: 83, measurement_count: 3 }, { date: '2026-09-17', mean_weight_kg: 82, measurement_count: 4 }, { date: '2026-09-19', mean_weight_kg: 81, measurement_count: 5 }] })) : service(url, options))
    const { container } = renderPage()
    const user = userEvent.setup()
    await screen.findByText('7-day average')
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(3))
    const average = container.querySelector('path.recharts-line-curve[stroke="var(--ep-semantic-chart-average)"]')!
    expect(average).toHaveAttribute('stroke-dasharray', '8 3')
    expect(average.getAttribute('d')!.match(/M/g)).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'About this chart' }))
    expect(screen.getByText(/previous 6 days/)).toBeVisible()
    fireEvent.keyDown(container.querySelector('[role="application"]')!, { key: 'ArrowRight' })
    await waitFor(() => expect(container.querySelector('.recharts-tooltip-wrapper')).toHaveTextContent('7-day average'))
    expect(container.querySelector('.recharts-tooltip-wrapper')).toHaveTextContent('83 kg')
    expect(container.querySelector('.recharts-tooltip-wrapper')).toHaveTextContent('Weight')
  })
})

describe('configurable rolling averages', () => {
  it('requests each window and retains the selection when changing the measurement period', async () => {
    const fetchMock = mockService([sample])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('7-day average')
    const selector = screen.getByRole('combobox', { name: 'Rolling average' })
    expect(selector).toHaveValue('7')
    await user.click(screen.getByRole('button', { name: 'About this chart' }))
    for (const days of [14, 30]) {
      await user.selectOptions(selector, String(days))
      await screen.findByText(`${days}-day average`)
      expect(fetchMock.mock.calls.some(([url]) => url.includes(`window_days=${days}`))).toBe(true)
      expect(screen.getByText(new RegExp(`previous ${days - 1} days`))).toBeVisible()
    }
    await user.click(screen.getByRole('button', { name: 'Last week' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/weight-logs/rolling-average?start_date=2026-09-13&end_date=2026-09-19&window_days=30', expect.anything()))
    expect(selector).toHaveValue('30')
    await user.selectOptions(selector, '7')
    await screen.findByText('7-day average')
  })

  it('does not relabel old average data while another window is pending or failed', async () => {
    const fetchMock = mockService([sample])
    const service = fetchMock.getMockImplementation()!
    let finish!: (response: Response) => void
    fetchMock.mockImplementation((url, options) => url.includes('window_days=14')
      ? new Promise<Response>((resolve) => { finish = resolve })
      : service(url, options))
    const user = userEvent.setup()
    const { container } = renderPage()
    await screen.findByText('7-day average')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rolling average' }), '14')
    expect(await screen.findByText('Loading 14-day average...')).toBeInTheDocument()
    expect(container.querySelector('path[stroke="var(--ep-semantic-chart-average)"]')).not.toBeInTheDocument()
    await openHistory(user)
    expect(screen.getByRole('table')).toBeInTheDocument()
    await openChart(user)
    finish(Response.json({}, { status: 500 }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the 14-day average')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rolling average' }), '7')
    expect(await screen.findByText('7-day average')).toBeInTheDocument()
  })
})

describe('data workspace', () => {
  it('composes six KPI tiles, one data view with logging, and transfer controls below it', async () => {
    mockService(dailyEntries(3), plannedGoal)
    renderPage()
    const summary = screen.getByRole('region', { name: 'Weight summary' })
    expect(await within(summary).findByRole('button', { name: 'Manage goal' })).toBeInTheDocument()
    expect(await within(summary).findByText('Mean weight')).toBeInTheDocument()
    expect(within(summary).getAllByRole('term').map((term) => term.textContent)).toEqual(['Measurements', 'Mean weight', 'First measurement', 'Latest measurement', 'Change', 'Weight goal'])
    const workspace = screen.getByRole('region', { name: 'Weight data' })
    const tabs = within(workspace).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Chart', 'History'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel')
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(panel).toHaveAccessibleName('Chart')
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const log = screen.getByRole('button', { name: 'Log weight' })
    expect(screen.getAllByRole('button', { name: 'Log weight' })).toHaveLength(1)
    expect(workspace).toContainElement(log)
    expect(log.compareDocumentPosition(panel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(workspace).getByRole('button', { name: 'Last month' })).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Import file', 'Export all history']) {
      const control = screen.getByRole('button', { name })
      expect(workspace).not.toContainElement(control)
      expect(workspace.compareDocumentPosition(control)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    }
  })

  it('shows the same period statistics in the KPIs, the chart and the history', async () => {
    mockService(dailyEntries(60))
    const user = userEvent.setup()
    const { container } = renderPage()
    const summary = screen.getByRole('region', { name: 'Weight summary' })
    for (const [label, count] of [['Last 2 weeks', 14], ['Last week', 7]] as const) {
      await user.click(screen.getByRole('button', { name: label }))
      expect(await within(summary).findByText(String(count))).toBeInTheDocument()
      await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(count))
      await openHistory(user)
      expect(screen.getByText(new RegExp(`of ${count}$`))).toBeInTheDocument()
      expect(within(summary).getByText(String(count))).toBeInTheDocument()
      await openChart(user)
    }
  })

  it('switches views from the keyboard and shows the matching panel', async () => {
    mockService([sample])
    const user = userEvent.setup()
    renderPage()
    const chartTab = await screen.findByRole('tab', { name: 'Chart' })
    chartTab.focus()
    await user.keyboard('{ArrowRight}')
    const historyTab = screen.getByRole('tab', { name: 'History' })
    expect(historyTab).toHaveFocus()
    expect(historyTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('History')
    expect(await screen.findByRole('table')).toBeVisible()
    expect(screen.queryByRole('application')).not.toBeInTheDocument()
    await user.keyboard('{Home}')
    expect(chartTab).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Chart')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(await screen.findByRole('application')).toBeVisible()
  })

  it('keeps the period, average window, goal visibility and history position when switching views', async () => {
    mockService(dailyEntries(60), plannedGoal)
    const user = userEvent.setup()
    const { container } = renderPage()
    await user.click(screen.getByRole('button', { name: 'All time' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rolling average' }), '14')
    await screen.findByText('14-day average')
    await user.click(await screen.findByRole('checkbox', { name: 'Show goal' }))
    await waitFor(() => expect(axisLabels(container).at(-1)).toBe('19 Sept'))
    await openHistory(user)
    await user.selectOptions(await screen.findByLabelText('Rows'), '25')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Showing 26–50 of 60')).toBeInTheDocument()
    await openChart(user)
    expect(screen.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('combobox', { name: 'Rolling average' })).toHaveValue('14')
    expect(screen.getByRole('checkbox', { name: 'Show goal' })).not.toBeChecked()
    expect(screen.getByText('14-day average')).toBeVisible()
    expect(axisLabels(container).at(-1)).toBe('19 Sept')
    await openHistory(user)
    expect(screen.getByText('Showing 26–50 of 60')).toBeInTheDocument()
    expect(screen.getByLabelText('Rows')).toHaveValue('25')
    await user.click(screen.getByRole('button', { name: 'Last month' }))
    expect(screen.getByText('Showing 1–25 of 32')).toBeInTheDocument()
    expect(screen.getByLabelText('Rows')).toHaveValue('25')
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await openChart(user)
    expect(screen.getByRole('combobox', { name: 'Rolling average' })).toHaveValue('14')
    expect(screen.getByRole('checkbox', { name: 'Show goal' })).not.toBeChecked()
  })
})

describe('after saving', () => {
  it('shows the refetched measurements, not the save acknowledgment, after logging weight', async () => {
    const fetchMock = mockService()
    acknowledgeWrongly(fetchMock)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('No measurements yet')
    const before = { list: requests(fetchMock, isListRead).length, summary: requests(fetchMock, isSummaryRead).length }
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: sample.date } })
    await user.type(screen.getByLabelText('Weight (kg)'), '82.5')
    await user.click(screen.getByRole('button', { name: 'Save weight' }))
    expect(await screen.findByText('Measurement saved.')).toBeInTheDocument()
    await openHistory(user)
    expect(within(screen.getByRole('table')).getByText('82.5')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Weight summary' })).getAllByText('82.5 kg')).toHaveLength(3)
    expect(screen.queryByText(/\b99\b/)).not.toBeInTheDocument()
    expect(requests(fetchMock, isListRead).length).toBeGreaterThan(before.list)
    expect(requests(fetchMock, isSummaryRead).length).toBeGreaterThan(before.summary)
  })

  it('refreshes the list and summary after an edit in History, and the chart when it is shown again', async () => {
    const fetchMock = mockService([sample])
    acknowledgeWrongly(fetchMock)
    const user = userEvent.setup()
    const { container } = renderPage()
    await screen.findByText('7-day average')
    await openActions(user)
    await user.click(screen.getByRole('button', { name: 'Edit measurement for 16 Sept 2026' }))
    await user.clear(screen.getByLabelText('Weight (kg)'))
    await user.type(screen.getByLabelText('Weight (kg)'), '81.25')
    const before = { list: requests(fetchMock, isListRead).length, summary: requests(fetchMock, isSummaryRead).length, average: requests(fetchMock, isAverageRead).length }
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Measurement updated.')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('81.25')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Weight summary' })).getAllByText('81.25 kg')).toHaveLength(3)
    expect(screen.queryByText(/\b99\b/)).not.toBeInTheDocument()
    expect(requests(fetchMock, isListRead).length).toBeGreaterThan(before.list)
    expect(requests(fetchMock, isSummaryRead).length).toBeGreaterThan(before.summary)
    await openChart(user)
    await waitFor(() => expect(requests(fetchMock, isAverageRead).length).toBeGreaterThan(before.average))
    const chart = container.querySelector('[role="application"]')!
    const tooltip = () => container.querySelector('.recharts-tooltip-wrapper')
    await waitFor(() => {
      fireEvent.keyDown(chart, { key: 'ArrowRight' })
      expect(tooltip()).toHaveTextContent(/7-day average : 81\.25 kg/)
    })
    expect(tooltip()).not.toHaveTextContent('82.5 kg')
  })

  it('refreshes every view after a delete in History, including the chart when it is shown again', async () => {
    const fetchMock = mockService([sample])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('7-day average')
    const before = requests(fetchMock, isAverageRead).length
    await openActions(user)
    await user.click(screen.getByRole('button', { name: 'Delete measurement for 16 Sept 2026' }))
    expect(await screen.findByText('Measurement deleted.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Weight summary' })).getByText('0')).toBeInTheDocument()
    await openChart(user)
    expect(await screen.findByText('No measurements in this period.')).toBeVisible()
    await waitFor(() => expect(requests(fetchMock, isAverageRead).length).toBeGreaterThan(before))
  })
})

describe('weight goal in the dashboard', () => {
  it('shows the KPIs, chart and history while the goal is pending, without inventing a no-goal state', async () => {
    const fetchMock = mockService(dailyEntries(3))
    const service = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, options) => url.includes('/weight-goals') ? new Promise<Response>(() => undefined) : service(url, options))
    const user = userEvent.setup()
    const { container } = renderPage()
    const summary = screen.getByRole('region', { name: 'Weight summary' })
    expect(await within(summary).findByText('Mean weight')).toBeInTheDocument()
    expect(within(summary).getByText('Loading goal…')).toHaveAttribute('role', 'status')
    expect(within(summary).queryByText('Not set')).not.toBeInTheDocument()
    expect(within(summary).queryByRole('button', { name: /goal/i })).not.toBeInTheDocument()
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(3))
    expect(screen.queryByRole('checkbox', { name: 'Show goal' })).not.toBeInTheDocument()
    await openHistory(user)
    expect(await screen.findByRole('table')).toBeVisible()
  })

  it('keeps the goal manageable while the summary and history both fail', async () => {
    const fetchMock = mockService([], plannedGoal)
    const service = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, options) => isSummaryRead(url) || isListRead(url, options)
      ? Promise.resolve(Response.json({}, { status: 500 }))
      : service(url, options))
    const user = userEvent.setup()
    renderPage()
    const summary = screen.getByRole('region', { name: 'Weight summary' })
    expect(await within(summary).findByText(/Could not load the period summary/)).toBeInTheDocument()
    expect(within(summary).getByRole('button', { name: 'Retry summary' })).toBeInTheDocument()
    expect(within(summary).getByText('78 kg')).toBeInTheDocument()
    await user.click(within(summary).getByRole('button', { name: 'Manage goal' }))
    const dialog = screen.getByRole('dialog', { name: 'Manage weight goal' })
    expect(within(dialog).getByRole('button', { name: 'Mark completed' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel goal' })).toBeEnabled()
  })

  it('keeps the KPIs, chart and history when only the goal lookup fails, and restores the goal path on retry', async () => {
    const fetchMock = mockService(dailyEntries(3), plannedGoal)
    const service = fetchMock.getMockImplementation()!
    let failGoal = true
    fetchMock.mockImplementation((url, options) => url.includes('/weight-goals') && failGoal ? Promise.resolve(Response.json({}, { status: 500 })) : service(url, options))
    const user = userEvent.setup()
    const { container } = renderPage()
    const summary = screen.getByRole('region', { name: 'Weight summary' })
    expect(await within(summary).findByText(/Could not load your goal/)).toBeInTheDocument()
    expect(await within(summary).findByText('Mean weight')).toBeInTheDocument()
    expect(within(summary).queryByText('Not set')).not.toBeInTheDocument()
    expect(within(summary).queryByRole('button', { name: 'Set goal' })).not.toBeInTheDocument()
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(3))
    expect(screen.queryByRole('checkbox', { name: 'Show goal' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Planned path to/)).not.toBeInTheDocument()
    failGoal = false
    await user.click(within(summary).getByRole('button', { name: 'Retry goal' }))
    expect(await within(summary).findByRole('button', { name: 'Manage goal' })).toBeInTheDocument()
    expect(within(summary).getByText('78 kg')).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: 'Show goal' })).toBeChecked()
    expect(within(screen.getByLabelText('Chart legend')).getByText('Planned path to 78 kg')).toBeInTheDocument()
  })

  it('adds and removes the planned path on the chart as the goal is saved and cancelled in the modal', async () => {
    mockService(dailyEntries(10))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    const { container } = renderPage()
    await screen.findByText('7-day average')
    await waitFor(() => expect(axisLabels(container).at(-1)).toBe('19 Sept'))
    expect(screen.queryByRole('checkbox', { name: 'Show goal' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Set goal' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    await user.type(screen.getByLabelText('Target weight (kg)'), '78')
    fireEvent.change(screen.getByLabelText('Target date (optional)'), { target: { value: '2027-01-29' } })
    await user.type(screen.getByLabelText('Starting weight (kg, optional)'), '83')
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    expect(await screen.findByText('Goal saved.')).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: 'Show goal' })).toBeChecked()
    expect(within(screen.getByLabelText('Chart legend')).getByText('Planned path to 78 kg')).toBeInTheDocument()
    await waitFor(() => expect(axisLabels(container).at(-1)).toBe('5 Oct'))
    await user.click(screen.getByRole('button', { name: 'Manage goal' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Manage weight goal' })).getByRole('button', { name: 'Cancel goal' }))
    expect(await screen.findByText('Goal cancelled.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Set goal' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Show goal' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Planned path to/)).not.toBeInTheDocument()
    await waitFor(() => expect(axisLabels(container).at(-1)).toBe('19 Sept'))
  })
})

describe('goal look-ahead on the chart', () => {
  it.each([
    ['Last week', '22 Sept'],
    ['Last 2 weeks', '26 Sept'],
    ['Last month', '5 Oct'],
    ['Last 3 months', '19 Oct'],
    ['Last 6 months', '19 Oct'],
    ['Last 12 months', '19 Oct'],
    ['All time', '19 Oct'],
  ] as const)('ends the axis for "%s" at %s', async (label, lastTick) => {
    mockService(dailyEntries(60), plannedGoal)
    const user = userEvent.setup()
    const { container } = renderPage()
    await screen.findByRole('checkbox', { name: 'Show goal' })
    await user.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(axisLabels(container).at(-1)).toBe(lastTick))
  })

  it('stops at an earlier target date and drops the extension when the goal is hidden', async () => {
    mockService(dailyEntries(60), { ...plannedGoal, target_date: '2026-09-24' })
    const user = userEvent.setup()
    const { container } = renderPage()
    const showGoal = await screen.findByRole('checkbox', { name: 'Show goal' })
    await waitFor(() => expect(axisLabels(container).at(-1)).toBe('24 Sept'))
    await user.click(showGoal)
    await waitFor(() => expect(axisLabels(container).at(-1)).toBe('19 Sept'))
    expect(screen.queryByText(/Planned path to/)).not.toBeInTheDocument()
  })
})

describe('transfer below the workspace', () => {
  it('exports all history regardless of the selected period and view', async () => {
    const fetchMock = mockService(dailyEntries(60))
    const service = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, options) => url.includes('/export') ? Promise.resolve(new Response('date,weight,unit\n')) : service(url, options))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValue('blob:test') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    try {
      const user = userEvent.setup()
      renderPage()
      await user.click(screen.getByRole('button', { name: 'Last week' }))
      await openHistory(user)
      expect(await screen.findByText('Showing 1–7 of 7')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Export all history' }))
      await waitFor(() => expect(click).toHaveBeenCalled())
      const exports = requests(fetchMock, (url) => url.includes('/export'))
      expect(exports).toHaveLength(1)
      expect(exports[0]![0]).toBe('/api/weight-logs/export?delimiter=comma')
    } finally {
      Reflect.deleteProperty(URL, 'createObjectURL')
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })
})