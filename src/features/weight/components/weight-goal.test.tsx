import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeightGoal } from '@/entities/weight-goal'
import { WeightGoalTile } from './weight-goal'

vi.mock('@clerk/react', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'session-a', getToken: async () => 'test-token' }) }))
const undated: WeightGoal = { id: 'goal-1', baseline_weight_kg: null, plan: null, target_weight_kg: 75, start_date: '2026-09-01', target_date: null, status: 'active', created_at: '2026-09-01T12:00:00Z', ended_at: null }
const dated: WeightGoal = { ...undated, baseline_weight_kg: 80, target_date: '2026-10-11', plan: { duration_days: 40, total_change_kg: -5, weekly_change_kg: -0.88, fortnightly_change_kg: -1.75 } }
afterEach(() => vi.useRealTimers())
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-20T12:00:00'))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})

interface Service {
  goal: WeightGoal | null
  loadStatus: number
  mutationStatus: number
  acknowledgment?: WeightGoal
  hold?: Promise<void>
}
function setup(initial: WeightGoal | null = null) {
  const service: Service = { goal: initial, loadStatus: 200, mutationStatus: 200 }
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method) await service.hold
    if (!options?.method) return service.loadStatus === 200 ? Response.json(service.goal) : Response.json({}, { status: service.loadStatus })
    if (service.mutationStatus !== 200) return Response.json({}, { status: service.mutationStatus })
    if (options.method === 'PUT') {
      service.goal = { ...undated, ...JSON.parse(options.body as string) }
      return Response.json(service.acknowledgment ?? service.goal)
    }
    const ended = { ...service.goal, ...JSON.parse(options.body as string) }
    service.goal = null
    return Response.json(service.acknowledgment ?? ended)
  })
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><dl><WeightGoalTile /></dl></QueryClientProvider>)
  const holdMutations = () => {
    let release!: () => void
    service.hold = new Promise<void>((resolve) => { release = resolve })
    return release
  }
  const calls = (method?: string) => fetchMock.mock.calls.filter(([, options]) => options?.method === method)
  return { fetchMock, client, service, holdMutations, calls, user: userEvent.setup() }
}
const requestBody = (call: [string, RequestInit?] | undefined) => JSON.parse(call![1]!.body as string)

describe('goal tile', () => {
  it('names the tile as a goal term and shows a loading state instead of a no-goal state', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><dl><WeightGoalTile /></dl></QueryClientProvider>)
    expect(screen.getByText('Weight goal').tagName).toBe('DT')
    expect(screen.getByText('Loading goal…')).toBeInTheDocument()
    expect(screen.queryByText('Not set')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([
    ['no goal', null, ['Not set', 'Add a target when it feels right for you'], 'Set goal'],
    ['a goal without a target date', undated, ['75 kg', 'No target date'], 'Manage goal'],
    ['a dated goal', dated, ['75 kg', 'By 11 Oct 2026'], 'Manage goal'],
  ] as const)('summarizes %s compactly with one management button', async (_name, goal, texts, action) => {
    setup(goal)
    expect(await screen.findByRole('button', { name: action })).toBeEnabled()
    for (const text of texts) expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reports a failed goal lookup without claiming there is no goal, and lets the person retry', async () => {
    const { service, calls, fetchMock, user } = setup(dated)
    service.loadStatus = 500
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your goal.')
    expect(screen.queryByText('Not set')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set goal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage goal' })).not.toBeInTheDocument()
    service.loadStatus = 200
    await user.click(screen.getByRole('button', { name: 'Retry goal' }))
    expect(await screen.findByRole('button', { name: 'Manage goal' })).toBeInTheDocument()
    expect(screen.getByText('75 kg')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(calls().length).toBe(2)
  })

  it('opens the management dialog from the keyboard and focuses its first field', async () => {
    const { user } = setup(dated)
    await screen.findByRole('button', { name: 'Manage goal' })
    await user.tab()
    expect(screen.getByRole('button', { name: 'Manage goal' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Manage weight goal' })).toBeInTheDocument()
    expect(screen.getByLabelText('Target weight (kg)')).toHaveFocus()
  })

  it('uses a setup title and a form only when there is no goal to manage', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Set goal' }))
    const dialog = screen.getByRole('dialog', { name: 'Set weight goal' })
    expect(within(dialog).queryByRole('heading', { name: 'Finish this goal' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Mark completed' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Cancel goal' })).not.toBeInTheDocument()
  })
})

describe('goal dialog', () => {
  it('creates a goal with an optional date and shows the refetched active goal, not the save acknowledgment', async () => {
    const { client, service, calls, user } = setup()
    service.acknowledgment = { ...undated, target_weight_kg: 1 }
    await user.click(await screen.findByRole('button', { name: 'Set goal' }))
    expect(screen.getByLabelText('Target weight (kg)')).toHaveFocus()
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-09-20')
    await user.type(screen.getByLabelText('Target weight (kg)'), '75.25')
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Target date (optional)'), { target: { value: '2027-01-01' } })
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    expect(await screen.findByText('75.25 kg')).toBeInTheDocument()
    expect(screen.queryByText('1 kg')).not.toBeInTheDocument()
    expect(screen.getByText('By 1 Jan 2027')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Goal saved.')).toHaveAttribute('role', 'status')
    const [save] = calls('PUT')
    expect(requestBody(save)).toEqual({ target_weight_kg: 75.25, start_date: '2026-09-01', target_date: '2027-01-01', baseline_weight_kg: null })
    expect(new Headers(save![1]!.headers).get('Authorization')).toBe('Bearer test-token')
    expect(calls()).toHaveLength(2)
    expect(client.getQueryData(['weight-goals', 'user-a', 'session-a'])).toMatchObject({ target_weight_kg: 75.25 })
  })

  it('restores focus to the goal button after a save', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Set goal' }))
    await user.type(screen.getByLabelText('Target weight (kg)'), '75')
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    expect(await screen.findByText('Goal saved.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage goal' })).toHaveFocus()
  })

  it('replaces the target with an explicit history explanation and allows no target date', async () => {
    const { calls, user } = setup(dated)
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    expect(screen.getByText(/replaces your current goal and preserves its history/)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Target weight (kg)'))
    await user.type(screen.getByLabelText('Target weight (kg)'), '80')
    fireEvent.change(screen.getByLabelText('Target date (optional)'), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    expect(await screen.findByText('80 kg')).toBeInTheDocument()
    expect(screen.getByText('No target date')).toBeInTheDocument()
    expect(requestBody(calls('PUT')[0]).target_date).toBeNull()
  })

  it.each([
    ['Mark completed', 'completed', 'Goal completed.'],
    ['Cancel goal', 'cancelled', 'Goal cancelled.'],
  ] as const)('asks before %s, keeps history, and returns to an empty goal tile', async (label, status, message) => {
    const { calls, user } = setup(dated)
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    expect(screen.getByText(/keeps it in your goal history/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: label }))
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/It will leave the chart\. Your previous goal will be saved\./))
    expect(calls('PATCH')).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: label }))
    expect(await screen.findByRole('button', { name: 'Set goal' })).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Not set')).toBeInTheDocument()
    expect(screen.getByText(message)).toHaveAttribute('role', 'status')
    expect(calls('PATCH')[0]![0]).toContain('/weight-goals/goal-1')
    expect(requestBody(calls('PATCH')[0])).toEqual({ status })
    expect(calls('DELETE')).toHaveLength(0)
  })

  it('offers no permanent way to delete a goal', async () => {
    const { user } = setup(dated)
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument()
  })

  it('keeps the dialog and the entered value when saving fails, and keeps it retryable', async () => {
    const { service, calls, user } = setup(undated)
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    service.mutationStatus = 500
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not update your goal')
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('Target weight (kg)')).toHaveValue(75)
    expect(screen.getByRole('button', { name: 'Save goal' })).toBeEnabled()
    service.mutationStatus = 200
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    expect(await screen.findByText('Goal saved.')).toBeInTheDocument()
    expect(calls('PUT')).toHaveLength(2)
  })

  it.each([['Mark completed'], ['Cancel goal']] as const)('keeps the dialog and explains the problem when %s fails', async (label) => {
    const { service, user } = setup(dated)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    service.mutationStatus = 409
    await user.click(screen.getByRole('button', { name: label }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This goal has changed. Refresh the page and try again.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
    expect(screen.getByText('75 kg')).toBeInTheDocument()
  })

  it('rejects an empty success response from saving a goal', async () => {
    const { fetchMock, user } = setup(undated)
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not update your goal')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('preserves a saved baseline and explains the service pace on demand', async () => {
    const { calls, user } = setup(dated)
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    const toggle = screen.getByRole('button', { name: 'About the planned pace' })
    const text = /Planned pace: -0.88 kg\/week \(-1.75 kg\/fortnight\), from 80 kg over 40 days\. This is your chosen plan, not a prediction\./
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(text)).not.toBeVisible()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(text)).toBeVisible()
    expect(screen.getByLabelText('Starting weight (kg, optional)')).toHaveValue(80)
    expect(screen.getByLabelText('Target date (optional)')).toHaveAttribute('min', '2026-09-02')
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    await waitFor(() => expect(calls('PUT')).toHaveLength(1))
    expect(requestBody(calls('PUT')[0]).baseline_weight_kg).toBe(80)
  })

  it('does not offer a pace for an undated goal', async () => {
    const { user } = setup(undated)
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    expect(screen.queryByRole('button', { name: 'About the planned pace' })).not.toBeInTheDocument()
  })

  it('does not invent a pace for a dated goal that has no plan', async () => {
    const { user } = setup({ ...undated, target_date: '2026-10-11' })
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    await user.click(screen.getByRole('button', { name: 'About the planned pace' }))
    expect(screen.getByText('Change your goal to set its starting weight and show a planned pace.')).toBeVisible()
    expect(screen.queryByText(/Planned pace:/)).not.toBeInTheDocument()
  })

  it('accepts a manual starting weight for a new dated goal', async () => {
    const { calls, user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Set goal' }))
    await user.type(screen.getByLabelText('Target weight (kg)'), '75')
    await user.type(screen.getByLabelText('Starting weight (kg, optional)'), '80.5')
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Target date (optional)'), { target: { value: '2026-11-01' } })
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    await waitFor(() => expect(calls('PUT')).toHaveLength(1))
    expect(requestBody(calls('PUT')[0]).baseline_weight_kg).toBe(80.5)
  })
})

describe('goal dialog dismissal and pending states', () => {
  it.each([
    ['the Close button', async (user: ReturnType<typeof userEvent.setup>) => { await user.click(screen.getByRole('button', { name: 'Close' })) }],
    ['the cancel event sent by Escape', async () => { fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true })) }],
  ] as const)('closes with %s, discards nothing on the service, and returns focus to the goal button', async (_name, dismiss) => {
    const { calls, user } = setup(dated)
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    await dismiss(user)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Manage goal' })).toHaveFocus()
    expect(screen.queryByText('Goal saved.')).not.toBeInTheDocument()
    expect(calls('PUT')).toHaveLength(0)
    expect(calls('PATCH')).toHaveLength(0)
  })

  it('shows progress and ignores Escape and repeated actions while a goal is saving', async () => {
    const { holdMutations, calls, user } = setup(undated)
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    const release = holdMutations()
    await user.click(screen.getByRole('button', { name: 'Save goal' }))
    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel goal' })).toBeDisabled()
    expect(screen.getByLabelText('Target weight (kg)')).toBeDisabled()
    const cancel = new Event('cancel', { cancelable: true })
    fireEvent(screen.getByRole('dialog'), cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(calls('PUT')).toHaveLength(1)
    await act(async () => { release() })
    expect(await screen.findByText('Goal saved.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['Mark completed', 'Completing...', 'Cancel goal'],
    ['Cancel goal', 'Cancelling...', 'Mark completed'],
  ] as const)('shows %s progress and blocks the other goal actions until it finishes', async (label, pending, other) => {
    const { holdMutations, calls, user } = setup(dated)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    await user.click(await screen.findByRole('button', { name: 'Manage goal' }))
    const release = holdMutations()
    await user.click(screen.getByRole('button', { name: label }))
    expect(await screen.findByRole('button', { name: pending })).toBeDisabled()
    expect(screen.getByRole('button', { name: other })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save goal' })).toBeDisabled()
    const cancel = new Event('cancel', { cancelable: true })
    fireEvent(screen.getByRole('dialog'), cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(calls('PATCH')).toHaveLength(1)
    await act(async () => { release() })
    expect(await screen.findByRole('button', { name: 'Set goal' })).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
