import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WeightLog, WeightLogInput } from '@/entities/weight-log'
import { WeightPage } from './weight-page'

const sample: WeightLog = { id: '083c82c3-f14c-429a-a89c-62f79c994be7', date: '2026-09-16', weight_kg: 82.5 }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><WeightPage /></QueryClientProvider>)
}

function mockService(initial: WeightLog[] = []) {
  let entries = [...initial]
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      const input = JSON.parse(options.body as string) as WeightLogInput
      if (entries.some((entry) => entry.date === input.date)) return Response.json({ detail: 'Duplicate date' }, { status: 409 })
      const entry = { id: sample.id, ...input }
      entries = [entry, ...entries]
      return Response.json(entry, { status: 201 })
    }
    if (options?.method === 'PATCH') {
      const entry = { ...sample, ...JSON.parse(options.body as string) as WeightLogInput }
      entries = [entry]
      return Response.json(entry)
    }
    if (options?.method === 'DELETE') {
      entries = []
      return new Response(null, { status: 204 })
    }
    return Response.json(entries)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('weight journal', () => {
  it('creates a measurement and shows the refreshed history', async () => {
    const fetchMock = mockService()
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('No measurements yet')).toBeInTheDocument()
    const now = new Date()
    expect(screen.getByLabelText('Date')).toHaveValue(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: sample.date } })
    await user.type(screen.getByLabelText('Weight (kg)'), '82.5')
    await user.click(screen.getByRole('button', { name: 'Save weight' }))
    expect(await screen.findByText('Measurement saved.')).toBeInTheDocument()
    expect(screen.getByText('82.5')).toBeInTheDocument()
    expect(screen.queryByText('No measurements yet')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/weight-logs', expect.objectContaining({ method: 'POST', body: JSON.stringify({ date: sample.date, weight_kg: 82.5 }) }))
  })

  it('edits the weight and date, and restores the add form after saving', async () => {
    const fetchMock = mockService([sample])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Edit measurement for 16 Sept 2026' }))
    expect(screen.getByLabelText('Weight (kg)')).toHaveFocus()
    await user.clear(screen.getByLabelText('Weight (kg)'))
    await user.type(screen.getByLabelText('Weight (kg)'), '81.25')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-15' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Measurement updated.')).toBeInTheDocument()
    expect(screen.getByText('81.25')).toBeInTheDocument()
    expect(screen.getByText('15 Sept 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save weight' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/weight-logs/${sample.id}`, expect.objectContaining({ method: 'PATCH' }))
  })

  it('requires confirmation before deleting and handles the empty 204 response', async () => {
    const fetchMock = mockService([sample])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Delete measurement for 16 Sept 2026' }))
    expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }))
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Delete measurement for 16 Sept 2026' }))
    expect(await screen.findByText('Measurement deleted.')).toBeInTheDocument()
    expect(screen.getByText('No measurements yet')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/weight-logs/${sample.id}`, { method: 'DELETE' })
  })

  it('preserves input when the date already has a measurement', async () => {
    mockService([sample])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('82.5')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: sample.date } })
    await user.type(screen.getByLabelText('Weight (kg)'), '83')
    await user.click(screen.getByRole('button', { name: 'Save weight' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A measurement already exists for this date')
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue(83)
    expect(screen.getByText('82.5')).toBeInTheDocument()
  })

  it('shows service errors separately from an empty history and can retry', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network error'))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the weight service')
    expect(screen.queryByText('No measurements yet')).not.toBeInTheDocument()
    fetchMock.mockResolvedValue(Response.json([]))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No measurements yet')).toBeInTheDocument()
  })

  it('prevents invalid weights from being submitted', async () => {
    const fetchMock = mockService()
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('No measurements yet')
    for (const weight of ['0', '-1', '82.123', '10000']) {
      await user.clear(screen.getByLabelText('Weight (kg)'))
      await user.type(screen.getByLabelText('Weight (kg)'), weight)
      await user.click(screen.getByRole('button', { name: 'Save weight' }))
      expect(screen.getByLabelText('Weight (kg)')).toBeInvalid()
    }
    expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }))
  })

  it('disables conflicting actions while a save is pending', async () => {
    const fetchMock = mockService([sample])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('82.5')
    let complete!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve }))
    await user.type(screen.getByLabelText('Weight (kg)'), '81')
    await user.click(screen.getByRole('button', { name: 'Save weight' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit measurement for 16 Sept 2026' })).toBeDisabled()
    expect(screen.getByLabelText('Weight (kg)')).toBeDisabled()
    complete(Response.json({ detail: 'Duplicate date' }, { status: 409 }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save weight' })).toBeEnabled())
  })
})
