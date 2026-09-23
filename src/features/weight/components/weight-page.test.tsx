import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeightLog, WeightLogInput } from '@/entities/weight-log'
import { WeightPage } from './weight-page'
import './weight-chart'

vi.mock('@clerk/react', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'session-a', getToken: async () => 'test-token' }) }))

const sample: WeightLog = { id: '083c82c3-f14c-429a-a89c-62f79c994be7', date: '2026-09-16', weight_kg: 82.5 }

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

function mockService(initial: WeightLog[] = []) {
  let entries = [...initial]
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/weight-goals')) return Response.json(null)
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

async function openActions(user: ReturnType<typeof userEvent.setup>, date = '16 Sept 2026') {
  await user.click(await screen.findByLabelText(`Actions for ${date}`))
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
    expect(within(screen.getByRole('table')).getByText('82.5')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('No measurements yet')).not.toBeInTheDocument()
    expect(await within(screen.getByRole('region', { name: 'Period summary' })).findByText('Add another measurement')).toBeInTheDocument()
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
    expect(within(screen.getByRole('region', { name: 'Period summary' })).getAllByText('81.25 kg')).toHaveLength(3)
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
    expect(within(screen.getByRole('region', { name: 'Period summary' })).getByText('0')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/weight-logs/${sample.id}`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('preserves dialog input when the date already has a measurement', async () => {
    mockService([sample])
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Log weight' }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: sample.date } })
    await user.type(screen.getByLabelText('Weight (kg)'), '83')
    await user.click(screen.getByRole('button', { name: 'Save weight' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A measurement already exists for this date')
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue(83)
    expect(within(screen.getByRole('table')).getByText('82.5')).toBeInTheDocument()
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
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'All time' }))
    expect(historyRows()).toHaveLength(10)
    expect(screen.getByText('Showing 1–10 of 60')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(60))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Showing 11–20 of 60')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).queryByText('19 Sept 2026')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(60)
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
  })

  it('shares the period between chart and history and resets pagination', async () => {
    mockService(dailyEntries(60))
    const user = userEvent.setup()
    const { container } = renderPage()
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'All time' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Last week' }))
    expect(screen.getByText('Showing 1–7 of 7')).toBeInTheDocument()
    expect(historyRows()).toHaveLength(7)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(7))
    await user.selectOptions(screen.getByLabelText('Period'), '2w')
    expect(screen.getByText('Showing 1–10 of 14')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Last 2 weeks' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(14))
  })

  it('clamps pagination when deleting the only row on the last page', async () => {
    mockService(dailyEntries(11))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderPage()
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
  it('uses authenticated inclusive bounds and updates the cards with the selected period', async () => {
    const fetchMock = mockService([{ ...sample, date: '2026-09-01', weight_kg: 90 }, { ...sample, id: 'latest', date: '2026-09-19', weight_kg: 80 }])
    const user = userEvent.setup()
    renderPage()
    const summary = await screen.findByRole('region', { name: 'Period summary' })
    expect(within(summary).getByText('85 kg')).toBeInTheDocument()
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
    const summary = await screen.findByRole('region', { name: 'Period summary' })
    expect(within(summary).getByText('0')).toBeInTheDocument()
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
    expect(await screen.findByRole('table')).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Retry summary' }))
    expect(await screen.findByRole('region', { name: 'Period summary' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})


describe('rolling average', () => {
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
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(1)
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
    await screen.findByText('7-day average')
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(3))
    const average = container.querySelector('path.recharts-line-curve[stroke="var(--ep-semantic-chart-average)"]')!
    expect(average).toHaveAttribute('stroke-dasharray', '8 3')
    expect(average.getAttribute('d')!.match(/M/g)).toHaveLength(2)
    expect(screen.getByText(/previous 6 days/)).toBeInTheDocument()
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
    for (const days of [14, 30]) {
      await user.selectOptions(selector, String(days))
      await screen.findByText(`${days}-day average`)
      expect(fetchMock.mock.calls.some(([url]) => url.includes(`window_days=${days}`))).toBe(true)
      expect(screen.getByText(new RegExp(`previous ${days - 1} days`))).toBeInTheDocument()
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
    expect(screen.getByRole('table')).toBeInTheDocument()
    finish(Response.json({}, { status: 500 }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the 14-day average')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rolling average' }), '7')
    expect(await screen.findByText('7-day average')).toBeInTheDocument()
  })
})