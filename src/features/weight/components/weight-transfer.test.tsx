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
  const fetchMock = vi.fn(async (url: string) => Response.json(url.endsWith('/preview') ? preview : { imported: 1, replaced: 0, skipped: 0 }))
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
  expect(fetchMock).toHaveBeenLastCalledWith('/api/weight-logs/import', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }), body: expect.stringContaining('"preview_token":"preview-one"') }))
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
  expect(fetchMock).toHaveBeenCalledWith('/api/weight-logs/export?delimiter=tab', expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }))
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
