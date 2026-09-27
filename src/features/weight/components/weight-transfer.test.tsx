import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { WeightTransfer } from './weight-transfer'

vi.mock('@clerk/react', () => ({ useAuth: () => ({ userId: 'user-a', sessionId: 'session-a', getToken: async () => 'test-token' }) }))
const preview = { rows: [{ row: 2, date: '2026-09-21', weight_kg: 99.79, action: 'import', errors: [] }], imported: 1, replaced: 0, skipped: 0, errors: 0, preview_token: 'preview-one' }
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><WeightTransfer busy={false} /></QueryClientProvider>)
  return { user: userEvent.setup(), client }
}
async function chooseFile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Import file' }))
  const file = new File(['date,weight,unit\n2026-09-21,220,lb'], 'measurements.csv')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('date,weight,unit\n2026-09-21,220,lb').buffer })
  fireEvent.change(screen.getByLabelText('Measurement file'), { target: { files: [file] } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview import' })).toBeEnabled())
}
it('previews normalized kg without writing, then confirms and invalidates all measurement queries', async () => {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    expect(options?.method).toBe('POST')
    return Response.json(url.endsWith('/preview') ? preview : { imported: 1, replaced: 0, skipped: 0 })
  })
  vi.stubGlobal('fetch', fetchMock)
  const { user, client } = setup()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  await chooseFile(user)
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  expect(await screen.findByText('99.79')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0]![0]).toContain('/import/preview')
  await user.click(screen.getByRole('button', { name: 'Confirm import' }))
  expect(await screen.findByText('Import complete: 1 added, 0 replaced, 0 skipped.')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenLastCalledWith('/api/weight-logs/import', expect.objectContaining({ body: expect.stringContaining('"preview_token":"preview-one"') }))
  expect(new Headers(fetchMock.mock.calls.at(-1)![1]?.headers).get('Authorization')).toBe('Bearer test-token')
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['weight-logs', 'user-a', 'session-a'] })
})
it('requires a fresh preview after changing duplicate policy and blocks invalid files', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(preview)).mockResolvedValueOnce(Response.json({ ...preview, errors: 1, rows: [{ row: 2, date: null, weight_kg: null, action: 'error', errors: ['Invalid date'] }] }))
  vi.stubGlobal('fetch', fetchMock)
  const { user } = setup()
  await chooseFile(user)
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  await screen.findByText('99.79')
  await user.selectOptions(screen.getByLabelText('Existing dates'), 'replace')
  expect(screen.getByRole('button', { name: 'Confirm import' })).toBeDisabled()
  expect(screen.queryByText('99.79')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  expect(await screen.findByText('Invalid date')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm import' })).toBeDisabled()
  expect(fetchMock).toHaveBeenLastCalledWith('/api/weight-logs/import/preview', expect.objectContaining({ body: expect.stringContaining('"duplicate_policy":"replace"') }))
})
it('preserves the file after a stale preview and requires preview again', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(preview)).mockResolvedValueOnce(new Response(null, { status: 409 })))
  const { user } = setup()
  await chooseFile(user)
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  await screen.findByText('99.79')
  await user.click(screen.getByRole('button', { name: 'Confirm import' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Preview the file again')
  expect(screen.getByRole('button', { name: 'Confirm import' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Preview import' })).toBeEnabled()
})
it('downloads tab-delimited data with an authenticated request and CSV filename', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('date\tweight\tunit\n'))
  vi.stubGlobal('fetch', fetchMock)
  const create = vi.fn().mockReturnValue('blob:test')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('emberpath-weight-history.csv') })
  const { user } = setup()
  await user.selectOptions(screen.getByLabelText('Export delimiter'), 'tab')
  await user.click(screen.getByRole('button', { name: 'Export all history' }))
  await waitFor(() => expect(click).toHaveBeenCalled())
  expect(fetchMock).toHaveBeenCalledWith('/api/weight-logs/export?delimiter=tab', expect.objectContaining({ method: 'GET' }))
  expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer test-token')
  expect(create).toHaveBeenCalled()
  click.mockRestore()
})

it.each([
  ['semicolon', 'date;weight;unit\n2026-09-21;220;lb', 'measurements.csv'],
  ['tab', 'date\tweight\tunit\n2026-09-21\t220\tlb', 'measurements.csv'],
  ['tab', 'date\tweight\tunit\n2026-09-21\t220\tlb', 'measurements.txt'],
])('previews a %s-delimited file using the selected delimiter', async (delimiter, content, filename) => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(preview))
  vi.stubGlobal('fetch', fetchMock)
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Import file' }))
  await user.selectOptions(screen.getByLabelText('Delimiter'), delimiter)
  const file = new File([content], filename)
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(content).buffer })
  fireEvent.change(screen.getByLabelText('Measurement file'), { target: { files: [file] } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview import' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  await screen.findByText('99.79')
  expect(fetchMock).toHaveBeenCalledWith('/api/weight-logs/import/preview', expect.objectContaining({
    body: expect.stringContaining(`"delimiter":"${delimiter}"`),
  }))
})

it('does not claim a preview is stale for an unexpected 409', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 409 })))
  const { user } = setup()
  await chooseFile(user)
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('could not complete the transfer')
  expect(screen.getByRole('button', { name: 'Confirm import' })).toBeDisabled()
})

it('does not report an export conflict as a stale import', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 409 })))
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Export all history' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('could not complete the transfer')
})

it('does not download a file for an empty export response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
  const create = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Export all history' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('could not complete the transfer')
  expect(create).not.toHaveBeenCalled()
})

it('requires a response body before treating preview as successful', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
  const { user } = setup()
  await chooseFile(user)
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('could not complete the transfer')
  expect(screen.getByRole('button', { name: 'Confirm import' })).toBeDisabled()
})

it('paginates preview rows without dropping normalized values or errors', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    row: index + 2, date: '2026-09-21', weight_kg: index + 0.25,
    action: 'import' as const, errors: [] as string[],
  }))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...preview, rows, imported: 101 })))
  const { user } = setup()
  await chooseFile(user)
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument()
  expect(screen.getByRole('table')).toHaveTextContent('99.25')
  expect(screen.getByRole('button', { name: 'Previous rows' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Next rows' }))
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  expect(screen.getByRole('table')).toHaveTextContent('100.25')
  expect(screen.getByRole('button', { name: 'Next rows' })).toBeDisabled()
})

it('clears the preview, errors, and page on file selection, then restores focus when closed', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    row: index + 2, date: '2026-09-21', weight_kg: index + 0.25,
    action: 'import' as const, errors: [] as string[],
  }))
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ...preview, rows, imported: 101 })).mockResolvedValueOnce(Response.json(preview))
  vi.stubGlobal('fetch', fetchMock)
  const { user } = setup()
  await chooseFile(user)
  expect(screen.getByRole('dialog', { name: 'Import measurements' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Next rows' }))
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Measurement file'), { target: { files: [new File(['{}'], 'measurements.json')] } })
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a .csv or .txt file.')
  expect(screen.queryByText('Page 2 of 2')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm import' })).toBeDisabled()
  const file = new File(['date,weight,unit'], 'new.csv')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('date,weight,unit').buffer })
  fireEvent.change(screen.getByLabelText('Measurement file'), { target: { files: [file] } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview import' })).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  expect(await screen.findByText('99.79')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Import file' })).toHaveFocus()
})

it('keeps the decoded file but requires a fresh preview after changing delimiter', async () => {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(preview)))
  vi.stubGlobal('fetch', fetchMock)
  const { user } = setup()
  await chooseFile(user)
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  await screen.findByText('99.79')
  await user.selectOptions(screen.getByLabelText('Delimiter'), 'tab')
  expect(screen.getByRole('button', { name: 'Preview import' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Confirm import' })).toBeDisabled()
  expect(screen.queryByText('99.79')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  await screen.findByText('99.79')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock).toHaveBeenLastCalledWith('/api/weight-logs/import/preview', expect.objectContaining({
    body: expect.stringContaining('"delimiter":"tab"'),
  }))
})

it('blocks cancel and preview while reading a file', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Import file' }))
  expect(screen.getByLabelText('Measurement file')).toHaveFocus()
  let finish!: (buffer: ArrayBuffer) => void
  const file = new File(['date,weight,unit'], 'measurements.csv')
  Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>((resolve) => { finish = resolve }) })
  fireEvent.change(screen.getByLabelText('Measurement file'), { target: { files: [file] } })
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Preview import' })).toBeDisabled()
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  finish(new TextEncoder().encode('date,weight,unit').buffer)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview import' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('button', { name: 'Import file' })).toHaveFocus()
})
