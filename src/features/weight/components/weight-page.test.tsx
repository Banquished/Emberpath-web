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
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the weight service')
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
