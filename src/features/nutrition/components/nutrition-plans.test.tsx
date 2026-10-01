import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveAllocationPreviewRequest, ActivePlanResponse, AllocationPreviewRequest, PlanHistoryResponse, SavePlanRequest, SavedPlan } from '@/entities/nutrition-plan'
import type { PreviewOptions, PreviewResponse, ProteinSelection } from '@/entities/nutrition-preview'
import { useActiveNutritionPlan, useNutritionPlanHistory } from '../api/nutrition-plans'
import { NutritionPage } from './nutrition-page'
import { NutritionPlanEditor, type AllocationStep } from './nutrition-plan-editor'
import { NutritionActivePlan, NutritionHistory } from './nutrition-plans'
import { downwardManualPreview, flatAllocation, manualPreview, savedPlan, suggestions, unevenAllocation, unevenDays } from '../test/plan-fixtures'

const optionsFixture: PreviewOptions = {
  methods: [
    { id: 'nasem_2023_adult_tee', source_id: 'nasem', source_url: 'https://example.org/nasem', scope: 'Adult estimate.' },
    { id: 'manual_target_v1', source_id: null, source_url: null, scope: 'User-chosen base.' },
  ],
  formula_parameters: ['male', 'female'],
  activity_categories: [
    { id: 'inactive', pal_min_inclusive: 1, pal_max_exclusive: 1.53 },
    { id: 'low_active', pal_min_inclusive: 1.53, pal_max_exclusive: 1.68 },
    { id: 'active', pal_min_inclusive: 1.68, pal_max_exclusive: 1.85 },
    { id: 'very_active', pal_min_inclusive: 1.85, pal_max_exclusive: 2.5 },
  ],
  activity_source_url: 'https://example.org/activity',
  starting_suggestions: suggestions,
  notice: manualPreview.notice,
}

const auth = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: true,
  userId: 'user-a',
  sessionId: 'session-a',
  getToken: vi.fn<() => Promise<string | null>>(),
}))
vi.mock('@clerk/react', () => ({ useAuth: () => auth }))

type Handler<T> = (input: T) => Response | Promise<Response>

function failure(status: number, detail: string, requestId = 'plan-request') {
  return Response.json({ detail, request_id: requestId }, { status, headers: { 'X-Request-ID': requestId } })
}

function mockPlanService(initialActive: ActivePlanResponse = { revision: 0, plan: null }) {
  const service: {
    active: ActivePlanResponse
    history: PlanHistoryResponse
    readActive?: (attempt: number) => Response | Promise<Response>
    readHistory?: (before: number | null) => Response | Promise<Response>
    allocation: Handler<AllocationPreviewRequest>
    activeAllocation: Handler<{ planId: string; body: ActiveAllocationPreviewRequest }>
    save: Handler<SavePlanRequest>
    replace: Handler<SavePlanRequest>
    end: Handler<{ expected_revision: number }>
  } = {
    active: initialActive,
    history: { revision: initialActive.revision, plans: initialActive.plan ? [initialActive.plan] : [], next_before_version: null },
    allocation: (input) => {
      const values = input.weekday_kcal
      if (input.accepted_preview.daily_target.kcal !== 2400 || !values) throw new Error('No allocation fixture for this accepted preview.')
      if (values.every((value) => value === 2400)) return Response.json(flatAllocation)
      if (values.join(',') === '2600,2400,2400,2400,2400,2400,2200') return Response.json(unevenAllocation)
      throw new Error(`No allocation fixture for ${values.join(',')}`)
    },
    activeAllocation: ({ planId, body }) => {
      if (service.active.plan?.id !== planId) return failure(404, 'Plan not found')
      if (service.active.revision !== body.expected_revision) return failure(409, 'Plan revision does not match')
      const values = body.weekday_kcal
      if (!values) throw new Error('No active allocation fixture without weekday values.')
      if (values.every((value) => value === 2400)) return Response.json(flatAllocation)
      if (values.join(',') === '2600,2400,2400,2400,2400,2400,2200') return Response.json(unevenAllocation)
      throw new Error(`No active allocation fixture for ${values.join(',')}`)
    },
    save: () => failure(503, 'Plan storage is not configured'),
    replace: () => failure(503, 'Plan storage is not configured'),
    end: () => failure(503, 'Plan storage is not configured'),
  }
  let activeReads = 0
  const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    if (url === '/api/nutrition/v1/plans/active' && method === 'GET') {
      activeReads += 1
      return service.readActive?.(activeReads) ?? Response.json(service.active)
    }
    if (url.startsWith('/api/nutrition/v1/plans?') && method === 'GET') {
      const before = new URL(url, 'http://localhost').searchParams.get('before_version')
      return service.readHistory?.(before === null ? null : Number(before)) ?? Response.json(service.history)
    }
    if (url === '/api/nutrition/v1/plans/allocations/preview' && method === 'POST') return service.allocation(JSON.parse(init!.body as string) as AllocationPreviewRequest)
    const activeAllocationPath = url.match(/^\/api\/nutrition\/v1\/plans\/([^/]+)\/allocations\/preview$/)
    if (activeAllocationPath && method === 'POST') {
      return service.activeAllocation({ planId: decodeURIComponent(activeAllocationPath[1]!), body: JSON.parse(init!.body as string) as ActiveAllocationPreviewRequest })
    }
    if (url === '/api/nutrition/v1/plans' && method === 'POST') return service.save(JSON.parse(init!.body as string) as SavePlanRequest)
    if (url === '/api/nutrition/v1/plans/active/replacements' && method === 'POST') return service.replace(JSON.parse(init!.body as string) as SavePlanRequest)
    if (url === '/api/nutrition/v1/plans/active/end' && method === 'POST') return service.end(JSON.parse(init!.body as string) as { expected_revision: number })
    throw new Error(`Unexpected endpoint ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { service, fetchMock }
}

function callsTo(fetchMock: ReturnType<typeof mockPlanService>['fetchMock'], url: string) {
  return fetchMock.mock.calls.filter(([path]) => path === url)
}

function mockWorkspace(initialActive: ActivePlanResponse = { revision: 0, plan: null }) {
  const { service, fetchMock: planFetch } = mockPlanService(initialActive)
  const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === '/api/nutrition/v1/estimates/options') return Response.json(optionsFixture)
    if (url === '/api/nutrition/v1/estimates/preview' && init?.method === 'POST') return Response.json(manualPreview)
    return planFetch(url, init)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { service, planFetch, fetchMock }
}

function renderWorkspace(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  const view = render(<QueryClientProvider client={client}><NutritionPage /></QueryClientProvider>)
  return { client, view }
}

async function fillNewManual(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('form', { name: 'Nutrition preview' })
  await user.click(screen.getByRole('radio', { name: 'Enter a manual base target' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Age (completed years)' }), '19')
  await user.type(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' }), '80')
  await user.type(screen.getByRole('spinbutton', { name: 'Manual base target (kcal/day)' }), '2400')
}

function renderPlans(preview: PreviewResponse | null = manualPreview) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  function Harness() {
    const [accepted, setAccepted] = useState(preview)
    const [step, setStep] = useState<AllocationStep>('weekdays')
    const [notice, setNotice] = useState('')
    const active = useActiveNutritionPlan()
    const history = useNutritionPlanHistory()
    return <>
      <NutritionActivePlan active={active} history={history} notice={notice} showFailure onMessageChange={setNotice} onNewCalculation={() => {}} />
      {accepted && <NutritionPlanEditor
        acceptedPreview={accepted}
        activeState={active.isSuccess ? active.data : null}
        step={step}
        onBack={() => step === 'review' ? setStep('weekdays') : setAccepted(null)}
        onReview={() => setStep('review')}
        onSaved={(plan) => { setNotice(`Nutrition plan version ${plan.version} saved. The previous active version remains in history.`); setAccepted(null) }}
        onRefreshActive={() => { setAccepted(null); void active.refetch(); void history.refetch() }}
      />}
      <NutritionHistory history={history} />
    </>
  }
  const view = render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>)
  return { client, view }
}

async function reviewedFlat() {
  const next = await screen.findByRole('button', { name: 'Next: Review and save' })
  await waitFor(() => expect(next).toBeEnabled())
  await userEvent.setup().click(next)
  return within(await screen.findByRole('region', { name: 'Provisional weekday targets' }))
}

async function confirmZone(user: ReturnType<typeof userEvent.setup>, zone = 'Europe/Oslo') {
  const field = screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' })
  await user.clear(field)
  await user.type(field, zone)
  await user.click(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ }))
}

beforeEach(() => {
  Object.assign(auth, { isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'session-a' })
  auth.getToken.mockReset().mockResolvedValue('test-token')
})
afterEach(() => vi.restoreAllMocks())

describe('Nutrition plan review and persistence', () => {
  it.each([
    [{ revision: 1, plan: savedPlan }, 'Active plan'],
    [{ revision: 0, plan: null }, 'Calculator'],
  ] satisfies [ActivePlanResponse, string][])('defaults to %s only after a confirmed active-plan status', async (initialActive, expected) => {
    mockWorkspace(initialActive)
    renderWorkspace()
    await waitFor(() => expect(screen.getByRole('tab', { name: expected })).toHaveAttribute('aria-selected', 'true'))
    if (expected === 'Calculator') await screen.findByRole('form', { name: 'Nutrition preview' })
    else await screen.findByText(/Version 1 · Started/)
    const tab = screen.getByRole('tab', { name: expected })
    const panel = document.getElementById(tab.getAttribute('aria-controls')!)
    expect(panel).toHaveAttribute('role', 'tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', tab.id)
    expect(panel).not.toHaveAttribute('hidden')
    for (const other of screen.getAllByRole('tab').filter((item) => item !== tab)) {
      expect(document.getElementById(other.getAttribute('aria-controls')!)).toHaveAttribute('hidden')
    }
  })

  it('preserves an explicit tab choice across a delayed active read and supports Arrow, Home and End focus', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const { service } = mockWorkspace({ revision: 1, plan: savedPlan })
    service.readActive = () => pending
    const user = userEvent.setup()
    renderWorkspace()
    await screen.findByRole('form', { name: 'Nutrition preview' })
    expect(screen.getByRole('status')).toHaveTextContent('Checking saved-plan status')
    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Active plan' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Calculator' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Calculator' })).toHaveFocus()
    await act(async () => { release(Response.json({ revision: 1, plan: savedPlan })); await pending })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Calculator' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('tab', { name: 'Active plan' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Calculator' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Active plan' })).toHaveAttribute('tabindex', '-1')
  })

  it('does not switch away from a calculator draft when the active response arrives after the user starts typing', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const { service } = mockWorkspace({ revision: 1, plan: savedPlan })
    service.readActive = () => pending
    const user = userEvent.setup()
    renderWorkspace()
    await fillNewManual(user)
    expect(screen.getByRole('tab', { name: 'Calculator' })).toHaveAttribute('aria-selected', 'true')
    await act(async () => { release(Response.json(service.active)); await pending })
    await waitFor(() => expect(screen.getByText(/Version 1 · Started/)).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Calculator' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('spinbutton', { name: 'Manual base target (kcal/day)' })).toHaveValue(2400)
  })

  it('retains inputs, accepted preview and weekday edits through tabs and Back without bypassing review', async () => {
    const { fetchMock, planFetch } = mockWorkspace()
    const user = userEvent.setup()
    renderWorkspace()
    await fillNewManual(user)
    await user.click(screen.getByRole('tab', { name: 'History' }))
    await user.click(screen.getByRole('tab', { name: 'Calculator' }))
    expect(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' })).toHaveValue(80)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    await screen.findByRole('region', { name: 'Provisional daily target preview' })
    expect(screen.getByRole('heading', { level: 2, name: 'Preview' })).toHaveFocus()
    expect(screen.queryByRole('spinbutton', { name: 'Monday (kcal)' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to inputs' }))
    expect(screen.getByRole('spinbutton', { name: 'Manual base target (kcal/day)' })).toHaveValue(2400)
    await user.click(screen.getByRole('button', { name: 'Continue to accepted preview' }))
    expect(screen.getByRole('region', { name: 'Provisional daily target preview' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/nutrition/v1/estimates/preview')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Next: Weekday targets' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Weekday targets' })).toHaveFocus()
    const monday = screen.getByRole('spinbutton', { name: 'Monday (kcal)' })
    const sunday = screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })
    await user.clear(monday)
    await user.type(monday, '2600')
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    await user.clear(sunday)
    await user.type(sunday, '2200')
    await user.click(screen.getByRole('tab', { name: 'History' }))
    await user.click(screen.getByRole('tab', { name: 'Calculator' }))
    expect(screen.getByRole('spinbutton', { name: 'Monday (kcal)' })).toHaveValue(2600)
    expect(screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })).toHaveValue(2200)
    await reviewedFlat()
    expect(screen.getByRole('heading', { level: 2, name: 'Review and save' })).toHaveFocus()
    expect(screen.getByText(/Some weekday targets differ from the chosen average/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Back to weekdays' }))
    await user.click(screen.getByRole('button', { name: 'Back to preview' }))
    await user.click(screen.getByRole('button', { name: 'Next: Weekday targets' }))
    expect(screen.getByRole('spinbutton', { name: 'Monday (kcal)' })).toHaveValue(2600)
    expect(screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })).toHaveValue(2200)
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Back to preview' }))
    await user.click(screen.getByRole('button', { name: 'Back to inputs' }))
    await user.clear(screen.getByRole('spinbutton', { name: 'Manual base target (kcal/day)' }))
    expect(screen.queryByRole('button', { name: 'Continue to accepted preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next: Weekday targets' })).not.toBeInTheDocument()
    expect(callsTo(planFetch, '/api/nutrition/v1/plans')).toHaveLength(0)
  })

  it('starts flat, uses a complete unchanged accepted preview, and waits for an active revision before saving', async () => {
    let releaseActive!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { releaseActive = resolve })
    const { service, fetchMock } = mockPlanService()
    service.readActive = (attempt) => attempt === 1 ? pending : Response.json(service.active)
    renderPlans()
    const review = await reviewedFlat()
    expect(review.getByText('Chosen average: 2,400 kcal/day. Planned full-week total: 16,800 kcal. These are targets, not food consumed.')).toBeInTheDocument()
    expect(review.getAllByText('2,400 kcal')).toHaveLength(7)
    expect(review.getByText('Monday').closest('tr')).toHaveTextContent('Monday2,400 kcal0 kcal128 g80 g292 g25 g')
    expect(review.getByText('Sunday').closest('tr')).toHaveTextContent('Sunday2,400 kcal0 kcal128 g80 g292 g25 g')
    expect(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    const allocationCall = callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')[0]!
    expect(JSON.parse(allocationCall[1]!.body as string)).toEqual({ accepted_preview: manualPreview, weekday_kcal: Array(7).fill(2400) })
    await act(async () => { releaseActive(Response.json({ revision: 0, plan: null })); await pending })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Saved-plan status changed since this review'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to weekdays' }))
    expect(screen.getByText('Remaining allocation: 0 kcal. The week is balanced.')).toBeInTheDocument()
    await reviewedFlat()
    await confirmZone(userEvent.setup())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save new plan' })).toBeEnabled())
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans')).toHaveLength(0)
  })

  it('shows remaining kcal without changing another day, derives targets on the server, and resets risk acknowledgment after edits', async () => {
    const { fetchMock } = mockPlanService()
    const user = userEvent.setup()
    renderPlans()
    await screen.findByText('No active nutrition plan. An unsaved calculator preview is not a plan.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeEnabled())
    const monday = screen.getByRole('spinbutton', { name: 'Monday (kcal)' })
    const sunday = screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })
    await user.clear(monday)
    await user.type(monday, '2600')
    expect(screen.getByText('Remaining allocation: -200 kcal. Adjust a weekday; no other day changes automatically.')).toBeInTheDocument()
    expect(sunday).toHaveValue(2400)
    expect(screen.queryByRole('region', { name: 'Provisional weekday targets' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    await user.clear(sunday)
    await user.type(sunday, '2200')
    const review = await reviewedFlat()
    expect(review.getByText('Monday').closest('tr')).toHaveTextContent('Monday2,600 kcal+200 kcal128 g86.67 g326.99 g25 g')
    expect(review.getByText('Sunday').closest('tr')).toHaveTextContent('Sunday2,200 kcal-200 kcal128 g73.33 g257.01 g25 g')
    expect(screen.getByText(/Some weekday targets differ from the chosen average/)).toBeInTheDocument()
    const acknowledgment = screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })
    expect(acknowledgment).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await user.click(acknowledgment)
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await confirmZone(user)
    expect(acknowledgment).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await user.click(acknowledgment)
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeEnabled()
    await user.type(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }), 'a')
    expect(acknowledgment).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Back to weekdays' }))
    const sundayAfterBack = screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })
    await user.clear(sundayAfterBack)
    await user.type(sundayAfterBack, '2199')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    await user.clear(sundayAfterBack)
    await user.type(sundayAfterBack, '2200')
    await reviewedFlat()
    expect(screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(3)
  })

  it('uses the server risk label for a downward manual adjustment, without calling it measured maintenance', async () => {
    const { service } = mockPlanService()
    service.allocation = () => Response.json({
      chosen_average_kcal: 2300,
      weekly_total_kcal: 16100,
      weekdays: flatAllocation.weekdays.map((day) => ({ ...day, target: downwardManualPreview.daily_target, delta_from_average_kcal: 0 })),
      risk_reasons: [{ code: 'downward_adjustment_from_manual_base', label: 'The chosen target is a downward adjustment from your manually entered base, not a measured or medically established deficit.' }],
      acknowledgment_required: true,
      notice: flatAllocation.notice,
    })
    renderPlans(downwardManualPreview)
    await reviewedFlat()
    expect(screen.getByText(/downward adjustment from your manually entered base, not a measured or medically established deficit/)).toBeInTheDocument()
    expect(screen.queryByText(/below estimated maintenance/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })).not.toBeChecked()
  })

  it('ignores a late flat allocation response after an edit and never enables save for stale or unbalanced days', async () => {
    let releaseFirst!: (response: Response) => void
    const first = new Promise<Response>((resolve) => { releaseFirst = resolve })
    const { service, fetchMock } = mockPlanService()
    let attempts = 0
    service.allocation = () => ++attempts === 1 ? first : Response.json(unevenAllocation)
    const user = userEvent.setup()
    renderPlans()
    await waitFor(() => expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(1))
    const monday = screen.getByRole('spinbutton', { name: 'Monday (kcal)' })
    await user.clear(monday)
    await user.type(monday, '2600')
    await act(async () => { releaseFirst(Response.json(flatAllocation)); await first })
    expect(screen.queryByRole('region', { name: 'Provisional weekday targets' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    const sunday = screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })
    await user.clear(sunday)
    await user.type(sunday, '2200')
    expect((await reviewedFlat()).getByText('Monday').closest('tr')).toHaveTextContent('2,600 kcal')
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(2)
  })

  it('keeps a balanced but infeasible server allocation error visible and never offers a save as a safety override', async () => {
    const { service } = mockPlanService()
    service.allocation = () => failure(422, 'Weekday target cannot accommodate chosen protein, fat and fibre', 'infeasible-id')
    renderPlans()
    expect(await screen.findByRole('alert')).toHaveTextContent('Weekday target cannot accommodate chosen protein, fat and fibre')
    expect(screen.getByText('Request ID: infeasible-id')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('requires a fresh calculator preview rather than retrying a stale stateless allocation as a saved review', async () => {
    const { service, planFetch } = mockWorkspace()
    let attempts = 0
    service.allocation = () => ++attempts === 1
      ? failure(409, 'Preview no longer matches; preview again', 'stale-calculation-id')
      : Response.json(flatAllocation)
    const user = userEvent.setup()
    renderWorkspace()
    await fillNewManual(user)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    await user.click(await screen.findByRole('button', { name: 'Next: Weekday targets' }))
    expect(await screen.findByRole('heading', { name: 'Calculation preview is stale' })).toBeInTheDocument()
    expect(screen.getByText('Request ID: stale-calculation-id')).toBeInTheDocument()
    expect(screen.getByText(/Return to Inputs and request a new calculator preview/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Back to preview' }))
    await user.click(screen.getByRole('button', { name: 'Back to inputs' }))
    expect(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' })).toHaveValue(80)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    await user.click(await screen.findByRole('button', { name: 'Next: Weekday targets' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeEnabled())
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(2)
    expect(callsTo(planFetch, '/api/nutrition/v1/plans')).toHaveLength(0)
  })

  it('saves only after a reviewed allocation, sends the expected revision and IANA zone, and refetches active/history', async () => {
    const { service, fetchMock } = mockPlanService()
    service.save = (body) => {
      expect(body).toEqual({
        accepted_preview: manualPreview,
        weekday_kcal: Array(7).fill(2400),
        expected_revision: 0,
        time_zone: 'Europe/Oslo',
      })
      service.active = { revision: 1, plan: savedPlan }
      service.history = { revision: 1, plans: [savedPlan], next_before_version: null }
      return Response.json(service.active, { status: 201 })
    }
    const user = userEvent.setup()
    renderPlans()
    await screen.findByText('No active nutrition plan. An unsaved calculator preview is not a plan.')
    await reviewedFlat()
    const zone = screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' })
    await user.clear(zone)
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await user.type(zone, 'Europe/Oslo')
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ }))
    await user.click(screen.getByRole('button', { name: 'Save new plan' }))
    expect(await screen.findByText(/Nutrition plan version 1 saved/)).toBeInTheDocument()
    expect(await screen.findByText(/Version 1 · Started/)).toHaveTextContent('Calendar zone: Europe/Oslo')
    expect(screen.getByText('Version 1 · Active')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review a new plan' })).not.toBeInTheDocument()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans')).toHaveLength(1)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active').length).toBeGreaterThan(1)
    expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/nutrition/v1/plans?')).length).toBeGreaterThan(1)
  })

  it('explicitly replaces an active plan, preserves the ended version in history, and never uses the create endpoint', async () => {
    const previous = { ...savedPlan, ended_at: '2026-09-29T17:00:00Z' }
    const next = { ...savedPlan, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2, started_at: '2026-09-29T17:00:00Z' }
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: savedPlan })
    service.replace = (body) => {
      expect(body).toEqual({
        accepted_preview: manualPreview,
        weekday_kcal: Array(7).fill(2400),
        expected_revision: 1,
        time_zone: 'Europe/Oslo',
      })
      service.active = { revision: 2, plan: next }
      service.history = { revision: 2, plans: [next, previous], next_before_version: null }
      return Response.json(service.active)
    }
    const user = userEvent.setup()
    renderPlans()
    await screen.findByText('Version 1 · Active')
    await reviewedFlat()
    expect(screen.getByRole('heading', { name: 'Review a replacement plan' })).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }))
    await user.type(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }), 'Europe/Oslo')
    await user.click(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ }))
    await user.click(screen.getByRole('button', { name: 'Replace active plan' }))
    expect(await screen.findByText(/Version 2 · Started/)).toBeInTheDocument()
    expect(await screen.findByText('Version 1 · Ended')).toBeInTheDocument()
    expect(screen.getByText('Version 2 · Active')).toBeInTheDocument()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(1)
    expect(callsTo(fetchMock, `/api/nutrition/v1/plans/${savedPlan.id}/allocations/preview`)).toHaveLength(0)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(1)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans')).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: 'Review a replacement plan' })).not.toBeInTheDocument()
  })

  it('edits weekdays directly from the immutable saved preview and requires a new explicit acknowledgment', async () => {
    const unevenSaved = { ...savedPlan, weekdays: unevenDays, day_allocation_risk_acknowledged: true }
    const next = { ...unevenSaved, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2, started_at: '2026-09-29T17:00:00Z' }
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: unevenSaved })
    service.replace = (body) => {
      expect(body).toEqual({
        accepted_preview: unevenSaved.accepted_preview,
        weekday_kcal: [2600, 2400, 2400, 2400, 2400, 2400, 2200],
        expected_revision: 1,
        time_zone: 'Europe/Oslo',
        acknowledge_day_allocation_risk: true,
      })
      service.active = { revision: 2, plan: next }
      service.history = { revision: 2, plans: [next, { ...unevenSaved, ended_at: '2026-09-29T17:00:00Z' }], next_before_version: null }
      return Response.json(service.active)
    }
    const user = userEvent.setup()
    renderPlans(null)
    expect(await screen.findByRole('button', { name: 'Edit weekdays' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Edit weekdays' }))
    expect(screen.getByRole('heading', { name: 'Edit saved weekdays' })).toBeInTheDocument()
    expect(screen.getByText(/Editing version 1 uses its unchanged accepted snapshot and saved calendar zone/)).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Monday (kcal)' })).toHaveValue(2600)
    expect(screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })).toHaveValue(2200)
    await reviewedFlat()
    expect(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' })).toHaveValue('Europe/Oslo')
    const ack = screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })
    expect(ack).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    await user.click(ack)
    await user.click(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ }))
    await user.click(screen.getByRole('button', { name: 'Replace active plan' }))
    expect(await screen.findByText(/Version 2 · Started/)).toBeInTheDocument()
    const reviewCalls = callsTo(fetchMock, `/api/nutrition/v1/plans/${unevenSaved.id}/allocations/preview`)
    expect(reviewCalls).toHaveLength(1)
    expect(JSON.parse(reviewCalls[0]![1]!.body as string)).toEqual({ expected_revision: 1, weekday_kcal: [2600, 2400, 2400, 2400, 2400, 2400, 2200] })
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(0)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(1)
    expect(callsTo(fetchMock, '/api/nutrition/v1/estimates/preview')).toHaveLength(0)
  })

  it('reviews a drifted historical snapshot from the active plan and submits that exact snapshot only for replacement', async () => {
    const historicalPreview: PreviewResponse = {
      ...manualPreview,
      starting_suggestions: {
        ...manualPreview.starting_suggestions,
        fibre_g_per_day: { ...manualPreview.starting_suggestions.fibre_g_per_day, scope: 'Earlier suggestion text.' },
      },
      notice: 'Earlier provisional notice.',
    }
    const original: SavedPlan = { ...savedPlan, accepted_preview: historicalPreview, weekdays: unevenDays, day_allocation_risk_acknowledged: true, notice: 'Earlier saved notice.' }
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: original })
    service.allocation = () => failure(409, 'Preview no longer matches; preview again', 'old-estimate')
    service.activeAllocation = ({ planId, body }) => {
      expect(planId).toBe(original.id)
      expect(body).toEqual({ expected_revision: 1, weekday_kcal: [2600, 2400, 2400, 2400, 2400, 2400, 2200] })
      return Response.json({ ...unevenAllocation, notice: 'Current neutral allocation notice.' })
    }
    const next: SavedPlan = { ...original, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2, started_at: '2026-09-29T17:00:00Z' }
    service.replace = (body) => {
      expect(body).toEqual({
        accepted_preview: historicalPreview,
        weekday_kcal: [2600, 2400, 2400, 2400, 2400, 2400, 2200],
        expected_revision: 1,
        time_zone: 'Europe/Oslo',
        acknowledge_day_allocation_risk: true,
      })
      service.active = { revision: 2, plan: next }
      service.history = { revision: 2, plans: [next, { ...original, ended_at: '2026-09-29T17:00:00Z' }], next_before_version: null }
      return Response.json(service.active)
    }
    const user = userEvent.setup()
    renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit weekdays' }))
    const review = await reviewedFlat()
    await user.click(review.getByText('About these targets'))
    expect(review.getByText('Current neutral allocation notice.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })).not.toBeChecked()
    expect(callsTo(fetchMock, `/api/nutrition/v1/plans/${original.id}/allocations/preview`)).toHaveLength(1)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(0)
    await user.click(screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ }))
    await user.click(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ }))
    await user.click(screen.getByRole('button', { name: 'Replace active plan' }))
    expect(await screen.findByText(/Version 2 · Started/)).toBeInTheDocument()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(1)
  })

  it.each([
    [404, 'Plan not found'],
    [409, 'Plan revision does not match'],
  ])('requires refreshing active and history after a %i historical allocation error without replaying that revision', async (status, detail) => {
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: savedPlan })
    service.activeAllocation = () => failure(status, detail, 'stale-review-id')
    const user = userEvent.setup()
    renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit weekdays' }))
    expect(await screen.findByRole('heading', { name: 'Saved allocation review is stale' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(status === 404 ? 'This saved plan could not be found.' : detail)
    expect(screen.getByText('Request ID: stale-review-id')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Monday (kcal)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refresh saved plan' })).toBeEnabled()
    const latest: SavedPlan = { ...savedPlan, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2, weekdays: unevenDays }
    service.active = { revision: 2, plan: latest }
    service.history = { revision: 2, plans: [latest, { ...savedPlan, ended_at: '2026-09-29T17:00:00Z' }], next_before_version: null }
    service.activeAllocation = ({ planId, body }) => {
      expect(planId).toBe(latest.id)
      expect(body).toEqual({ expected_revision: 2, weekday_kcal: [2600, 2400, 2400, 2400, 2400, 2400, 2200] })
      return Response.json(unevenAllocation)
    }
    await user.click(screen.getByRole('button', { name: 'Refresh saved plan' }))
    expect(await screen.findByText('Version 2 · Active')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Edit saved weekdays' })).not.toBeInTheDocument()
    expect(callsTo(fetchMock, `/api/nutrition/v1/plans/${savedPlan.id}/allocations/preview`)).toHaveLength(1)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active').length).toBeGreaterThan(1)
    expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/nutrition/v1/plans?')).length).toBeGreaterThan(1)
    await user.click(screen.getByRole('button', { name: 'Edit weekdays' }))
    await reviewedFlat()
    expect(screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    expect(callsTo(fetchMock, `/api/nutrition/v1/plans/${latest.id}/allocations/preview`)).toHaveLength(1)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(0)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
  })

  it('does not resurrect an old successful allocation if the active plan changes while review is pending', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: savedPlan })
    service.activeAllocation = () => pending
    const user = userEvent.setup()
    const { client } = renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit weekdays' }))
    await waitFor(() => expect(callsTo(fetchMock, `/api/nutrition/v1/plans/${savedPlan.id}/allocations/preview`)).toHaveLength(1))
    const latest: SavedPlan = { ...savedPlan, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2 }
    service.active = { revision: 2, plan: latest }
    await act(async () => { await client.invalidateQueries({ queryKey: ['nutrition', 'plans', 'active', 'user-a', 'session-a'] }) })
    await act(async () => { release(Response.json(unevenAllocation)); await pending })
    expect(screen.queryByRole('region', { name: 'Provisional weekday targets' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This saved plan is no longer active'))
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(0)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
  })

  it('does not fall back to DB-free allocation if the active plan read fails during a saved edit', async () => {
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: savedPlan })
    const user = userEvent.setup()
    const { client } = renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit weekdays' }))
    await reviewedFlat()
    service.readActive = () => failure(503, 'Plan storage is not configured', 'read-failure-id')
    await act(async () => { await client.invalidateQueries({ queryKey: ['nutrition', 'plans', 'active', 'user-a', 'session-a'] }) })
    expect(await screen.findByText('Request ID: read-failure-id')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Provisional weekday targets' })).not.toBeInTheDocument()
    expect(screen.getByText(/active saved plan and revision must load before reviewing or replacing/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    expect(callsTo(fetchMock, `/api/nutrition/v1/plans/${savedPlan.id}/allocations/preview`)).toHaveLength(1)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(0)
  })

  it.each([
    [401, 'Invalid or missing session', 'Session verification failed'],
    [403, 'Forbidden', 'Nutrition access denied'],
    [422, 'Weekday target cannot accommodate chosen protein, fat and fibre', 'Weekday review unavailable: check your inputs'],
    [503, 'Plan storage is not configured', 'Weekday review unavailable'],
  ])('shows active-allocation %i without enabling a saved replacement or using the stateless endpoint', async (status, detail, heading) => {
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: savedPlan })
    service.activeAllocation = () => failure(status, detail, 'active-error-id')
    const user = userEvent.setup()
    renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit weekdays' }))
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByText('Request ID: active-error-id')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(0)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
  })

  it('shows storage-unavailable 503 as a failed save with its request ID and leaves active/history unchanged', async () => {
    const { service, fetchMock } = mockPlanService()
    const user = userEvent.setup()
    renderPlans()
    await reviewedFlat()
    await confirmZone(user)
    await user.click(await screen.findByRole('button', { name: 'Save new plan' }))
    expect(await screen.findByRole('heading', { name: 'Plan was not saved' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('storage is not configured')
    expect(screen.getByText('Request ID: plan-request')).toBeInTheDocument()
    expect(screen.getByText('No active nutrition plan. An unsaved calculator preview is not a plan.')).toBeInTheDocument()
    expect(screen.getByText('No saved plan versions yet.')).toBeInTheDocument()
    expect(screen.queryByText(/Nutrition plan version \d+ saved/)).not.toBeInTheDocument()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans')).toHaveLength(1)
    service.save = () => {
      service.active = { revision: 1, plan: savedPlan }
      service.history = { revision: 1, plans: [savedPlan], next_before_version: null }
      return Response.json(service.active, { status: 201 })
    }
    await user.click(screen.getByRole('button', { name: 'Save new plan' }))
    expect(await screen.findByText(/Nutrition plan version 1 saved/)).toBeInTheDocument()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans')).toHaveLength(2)
  })

  it('requires a fresh risk acknowledgment for every replacement attempt, including after a storage failure', async () => {
    const prior = { ...savedPlan, weekdays: unevenDays, day_allocation_risk_acknowledged: true }
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: prior })
    const user = userEvent.setup()
    renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit weekdays' }))
    await reviewedFlat()
    const ack = screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })
    expect(ack).not.toBeChecked()
    await user.click(ack)
    await user.click(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ }))
    await user.click(screen.getByRole('button', { name: 'Replace active plan' }))
    expect(await screen.findByRole('heading', { name: 'Plan was not saved' })).toBeInTheDocument()
    expect(ack).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    expect(screen.getByText('Version 1 · Active')).toBeInTheDocument()
    const next: SavedPlan = { ...prior, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2, started_at: '2026-09-29T17:00:00Z' }
    service.replace = (body) => {
      expect(body.acknowledge_day_allocation_risk).toBe(true)
      service.active = { revision: 2, plan: next }
      service.history = { revision: 2, plans: [next, { ...prior, ended_at: '2026-09-29T17:00:00Z' }], next_before_version: null }
      return Response.json(service.active)
    }
    await user.click(ack)
    await user.click(screen.getByRole('button', { name: 'Replace active plan' }))
    expect(await screen.findByText(/Version 2 · Started/)).toBeInTheDocument()
    const requests = callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')
    expect(requests).toHaveLength(2)
    expect(requests.map(([, init]) => JSON.parse(init!.body as string) as SavePlanRequest)).toEqual([
      expect.objectContaining({ expected_revision: 1, acknowledge_day_allocation_risk: true }),
      expect.objectContaining({ expected_revision: 1, acknowledge_day_allocation_risk: true }),
    ])
  })

  it('requires confirmation before ending and refetches active state and paginated, immutable history', async () => {
    const endedFirst = { ...savedPlan, ended_at: '2026-09-29T17:00:00Z' }
    const second: SavedPlan = { ...savedPlan, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2, started_at: '2026-09-29T17:00:00Z' }
    let firstPage: PlanHistoryResponse = { revision: 2, plans: [second], next_before_version: 2 }
    const { service, fetchMock } = mockPlanService({ revision: 2, plan: second })
    service.readHistory = (before) => Response.json(before === 2 ? { revision: firstPage.revision, plans: [endedFirst], next_before_version: null } : firstPage)
    service.end = (body) => {
      expect(body).toEqual({ expected_revision: 2 })
      service.active = { revision: 3, plan: null }
      firstPage = { revision: 3, plans: [{ ...second, ended_at: '2026-09-29T18:00:00Z' }], next_before_version: 2 }
      return Response.json(service.active)
    }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const user = userEvent.setup()
    renderPlans(null)
    expect(await screen.findByText('Version 2 · Active')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more saved versions' }))
    expect(await screen.findByText('Version 1 · Ended')).toBeInTheDocument()
    await user.click(screen.getByText('View saved version 1 details'))
    expect(screen.getByRole('region', { name: 'Version 1 saved targets' })).toHaveTextContent('Monday')
    await user.click(screen.getByRole('button', { name: 'End plan' }))
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/end')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'End plan' }))
    expect(await screen.findByText('Nutrition plan ended. Its saved history remains available.')).toBeInTheDocument()
    expect(await screen.findByText('No active nutrition plan. An unsaved calculator preview is not a plan.')).toBeInTheDocument()
    expect(await screen.findByText('Version 2 · Ended')).toBeInTheDocument()
    expect(screen.getByText('Version 1 · Ended')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/end')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('before_version=2')).length).toBeGreaterThan(1)
  })

  it('keeps end confirmation visible on the active tab and replaces it with the next save result', async () => {
    const { service, planFetch } = mockWorkspace({ revision: 1, plan: savedPlan })
    const next: SavedPlan = {
      ...savedPlan,
      id: 'c83c82c3-f14c-429a-a89c-62f79c994be7',
      version: 2,
      started_at: '2026-09-29T17:00:00Z',
    }
    service.end = ({ expected_revision }) => {
      expect(expected_revision).toBe(1)
      service.active = { revision: 2, plan: null }
      service.history = { revision: 2, plans: [{ ...savedPlan, ended_at: next.started_at }], next_before_version: null }
      return Response.json(service.active)
    }
    service.save = (body) => {
      expect(body.expected_revision).toBe(2)
      expect(body.accepted_preview).toEqual(manualPreview)
      service.active = { revision: 3, plan: next }
      service.history = { revision: 3, plans: [next, { ...savedPlan, ended_at: next.started_at }], next_before_version: null }
      return Response.json(service.active, { status: 201 })
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderWorkspace()
    await screen.findByText(/Version 1 · Started/)
    await user.click(screen.getByRole('button', { name: 'End plan' }))
    expect(await screen.findByText('Nutrition plan ended. Its saved history remains available.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Active plan' })).toHaveAttribute('aria-selected', 'true')
    await screen.findByText('No active nutrition plan. An unsaved calculator preview is not a plan.')
    await user.click(screen.getByRole('button', { name: 'New calculation' }))
    expect(screen.getByRole('tab', { name: 'Calculator' })).toHaveAttribute('aria-selected', 'true')
    await fillNewManual(user)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    await user.click(await screen.findByRole('button', { name: 'Next: Weekday targets' }))
    await reviewedFlat()
    await confirmZone(user)
    await user.click(screen.getByRole('button', { name: 'Save new plan' }))
    expect(await screen.findByText(/Nutrition plan version 2 saved/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Active plan' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('Nutrition plan ended. Its saved history remains available.')).not.toBeInTheDocument()
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/active/end')).toHaveLength(1)
    expect(callsTo(planFetch, '/api/nutrition/v1/plans')).toHaveLength(1)
  })

  it('keeps an active plan unchanged on a 409 revision conflict, then refreshes instead of resubmitting stale data', async () => {
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: savedPlan })
    const user = userEvent.setup()
    service.replace = () => failure(409, 'Plan revision does not match', 'conflict-id')
    renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit weekdays' }))
    await reviewedFlat()
    await user.click(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ }))
    await user.click(screen.getByRole('button', { name: 'Replace active plan' }))
    expect(await screen.findByRole('heading', { name: 'Plan was not saved' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Plan revision does not match')
    expect(screen.getByText('Request ID: conflict-id')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    expect(screen.getByText('Version 1 · Active')).toBeInTheDocument()
    const latest = { ...savedPlan, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2 }
    service.active = { revision: 2, plan: latest }
    service.history = { revision: 2, plans: [latest, { ...savedPlan, ended_at: '2026-09-29T17:00:00Z' }], next_before_version: null }
    await user.click(screen.getByRole('button', { name: 'Refresh saved plan' }))
    expect(await screen.findByText('Version 2 · Active')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Edit saved weekdays' })).not.toBeInTheDocument()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(1)
  })

  it('recovers a conflicted new calculation only after explicit revision refresh and a renewed server review', async () => {
    const { service, planFetch, fetchMock } = mockWorkspace()
    service.save = () => {
      service.active = { revision: 1, plan: savedPlan }
      service.history = { revision: 1, plans: [savedPlan], next_before_version: null }
      return failure(409, 'Another session created an active plan', 'new-conflict-id')
    }
    const user = userEvent.setup()
    renderWorkspace()
    await fillNewManual(user)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    await user.click(await screen.findByRole('button', { name: 'Next: Weekday targets' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Monday (kcal)' }), { target: { value: '2600' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Sunday (kcal)' }), { target: { value: '2200' } })
    await reviewedFlat()
    await confirmZone(user)
    await user.click(screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ }))
    await user.click(screen.getByRole('button', { name: 'Save new plan' }))
    await screen.findByText('Request ID: new-conflict-id')
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Back to weekdays' }))
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: 'History' }))
    await user.click(screen.getByRole('tab', { name: 'Calculator' }))
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()

    let releaseActive!: (response: Response) => void
    const pendingActive = new Promise<Response>((resolve) => { releaseActive = resolve })
    service.readActive = () => pendingActive
    let releaseAllocation!: (response: Response) => void
    const pendingAllocation = new Promise<Response>((resolve) => { releaseAllocation = resolve })
    service.allocation = (body) => {
      expect(body).toEqual({ accepted_preview: manualPreview, weekday_kcal: [2600, 2400, 2400, 2400, 2400, 2400, 2200] })
      return pendingAllocation
    }
    const previousReviews = callsTo(planFetch, '/api/nutrition/v1/plans/allocations/preview').length
    await user.click(screen.getByRole('button', { name: 'Refresh saved plan' }))
    expect(screen.getByRole('button', { name: 'Refresh saved plan' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    expect(screen.getByText('Request ID: new-conflict-id')).toBeInTheDocument()
    await act(async () => { releaseActive(Response.json(service.active)); await pendingActive })
    await waitFor(() => expect(callsTo(planFetch, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(previousReviews + 1))
    expect(screen.queryByText('Request ID: new-conflict-id')).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Monday (kcal)' })).toHaveValue(2600)
    expect(screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })).toHaveValue(2200)
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    await act(async () => { releaseAllocation(Response.json(unevenAllocation)); await pendingAllocation })
    await reviewedFlat()
    expect(screen.getByRole('heading', { name: 'Review a replacement plan' })).toBeInTheDocument()
    const zone = screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ })
    const risk = screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })
    expect(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' })).toHaveValue('Europe/Oslo')
    expect(zone).not.toBeChecked()
    expect(risk).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    expect(callsTo(planFetch, '/api/nutrition/v1/plans')).toHaveLength(1)
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
    await user.click(zone)
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    await user.click(risk)
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeEnabled()

    const replacement: SavedPlan = { ...savedPlan, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2, weekdays: unevenDays, day_allocation_risk_acknowledged: true }
    service.readActive = undefined
    service.replace = (body) => {
      expect(body).toEqual({
        accepted_preview: manualPreview,
        weekday_kcal: [2600, 2400, 2400, 2400, 2400, 2400, 2200],
        expected_revision: 1,
        time_zone: 'Europe/Oslo',
        acknowledge_day_allocation_risk: true,
      })
      service.active = { revision: 2, plan: replacement }
      service.history = { revision: 2, plans: [replacement, { ...savedPlan, ended_at: replacement.started_at }], next_before_version: null }
      return Response.json(service.active)
    }
    await user.click(screen.getByRole('button', { name: 'Replace active plan' }))
    await screen.findByText(/Nutrition plan version 2 saved/)
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(1)
    expect(callsTo(planFetch, `/api/nutrition/v1/plans/${savedPlan.id}/allocations/preview`)).toHaveLength(0)
    expect(callsTo(fetchMock, '/api/nutrition/v1/estimates/preview')).toHaveLength(1)
  })

  it.each([
    ['failed', () => failure(503, 'Plan storage is unavailable', 'refresh-failure-id')],
    ['invalid', () => Response.json({ revision: 1, plan: { id: savedPlan.id } })],
  ] satisfies [string, () => Response][])('keeps a conflicted new calculation blocked after a %s explicit refresh', async (_label, response) => {
    const { service, planFetch } = mockWorkspace()
    service.save = () => {
      service.active = { revision: 1, plan: savedPlan }
      return failure(409, 'Another session created an active plan', 'new-conflict-id')
    }
    const user = userEvent.setup()
    const { client } = renderWorkspace()
    await fillNewManual(user)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    await user.click(await screen.findByRole('button', { name: 'Next: Weekday targets' }))
    await reviewedFlat()
    await confirmZone(user)
    await user.click(screen.getByRole('button', { name: 'Save new plan' }))
    await screen.findByText('Request ID: new-conflict-id')
    const previousReviews = callsTo(planFetch, '/api/nutrition/v1/plans/allocations/preview').length
    service.readActive = response
    await user.click(screen.getByRole('button', { name: 'Refresh saved plan' }))
    await screen.findByRole('heading', { name: 'Saved plan status unavailable' })
    expect(screen.getByText('Request ID: new-conflict-id')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Monday (kcal)' })).toHaveValue(2400)
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(previousReviews)
    service.readActive = undefined
    await act(async () => { await client.invalidateQueries({ queryKey: ['nutrition', 'plans', 'active', 'user-a', 'session-a'] }) })
    expect(screen.getByText('Request ID: new-conflict-id')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    expect(callsTo(planFetch, '/api/nutrition/v1/plans')).toHaveLength(1)
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Refresh saved plan' }))
    await reviewedFlat()
    expect(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
  })

  it('blocks edits to a saved version that stopped being active during an in-flight review', async () => {
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: savedPlan })
    const user = userEvent.setup()
    const { client } = renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit weekdays' }))
    await reviewedFlat()
    const latest = { ...savedPlan, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2 }
    service.active = { revision: 2, plan: latest }
    await act(async () => { await client.invalidateQueries({ queryKey: ['nutrition', 'plans', 'active', 'user-a', 'session-a'] }) })
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active')).toHaveLength(2)
    await screen.findByText(/This saved plan is no longer active/)
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Refresh saved plan' }))
    expect(await screen.findByText(/Version 2 · Started/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Edit saved weekdays' })).not.toBeInTheDocument()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
  })

  it('reports a 422 write or end rejection without a success notice or invented lifecycle transition', async () => {
    const { service } = mockPlanService({ revision: 1, plan: savedPlan })
    service.replace = () => failure(422, 'Invalid IANA time zone', 'zone-id')
    service.end = () => failure(422, 'Invalid request', 'end-id')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit weekdays' }))
    await reviewedFlat()
    await user.clear(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }))
    await user.type(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }), 'Invalid/Zone')
    expect(screen.getByText('Enter a valid IANA time zone.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    await user.clear(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }))
    await user.type(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }), 'Europe/Oslo')
    await user.click(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ }))
    await user.click(screen.getByRole('button', { name: 'Replace active plan' }))
    expect(await screen.findByRole('heading', { name: 'Plan was not saved: check your inputs' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid IANA time zone')
    expect(screen.getByText('Request ID: zone-id')).toBeInTheDocument()
    expect(screen.queryByText(/Nutrition plan version 2 saved/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Leave without saving' }))
    await user.click(screen.getByRole('button', { name: 'End plan' }))
    expect(await screen.findByRole('heading', { name: 'Plan was not ended: check your inputs' })).toBeInTheDocument()
    expect(screen.getByText('Request ID: end-id')).toBeInTheDocument()
    expect(screen.getByText('Version 1 · Active')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('does not issue a plan request without a session or disguise the failure as empty history', async () => {
    auth.getToken.mockResolvedValue(null)
    const { fetchMock } = mockPlanService()
    renderPlans()
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Session verification failed' }).length).toBeGreaterThanOrEqual(2))
    expect(screen.queryByText('No saved plan versions yet.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not disguise forbidden allocation and plan reads as an empty history or allow a write', async () => {
    const { service, fetchMock } = mockPlanService()
    service.readActive = () => failure(403, 'Forbidden', 'denied-id')
    service.readHistory = () => failure(403, 'Forbidden', 'denied-id')
    service.allocation = () => failure(403, 'Forbidden', 'denied-id')
    renderPlans()
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Nutrition access denied' })).toHaveLength(3))
    expect(screen.getAllByText('Request ID: denied-id')).toHaveLength(3)
    expect(screen.queryByText('No saved plan versions yet.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next: Review and save' })).toBeDisabled()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans')).toHaveLength(0)
  })

  it('keeps the DB-free calculator available during storage failure, labels reads as failures, and retries them without inventing history', async () => {
    const { service, fetchMock: planFetch } = mockPlanService()
    let storageAvailable = false
    service.readActive = () => storageAvailable ? Response.json(service.active) : failure(503, 'Plan storage is not configured', 'storage-id')
    service.readHistory = () => storageAvailable ? Response.json(service.history) : failure(503, 'Plan storage is not configured', 'storage-id')
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/nutrition/v1/estimates/options') return Response.json(optionsFixture)
      if (url === '/api/nutrition/v1/estimates/preview' && init?.method === 'POST') return Response.json(manualPreview)
      return planFetch(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const user = userEvent.setup()
    render(<QueryClientProvider client={client}><NutritionPage /></QueryClientProvider>)
    await screen.findByRole('form', { name: 'Nutrition preview' })
    await waitFor(() => expect(screen.getAllByText('Request ID: storage-id')).toHaveLength(2))
    expect(screen.getAllByText('Saved plans are unavailable because nutrition storage is not configured.')).toHaveLength(2)
    expect(screen.queryByText('No saved plan versions yet.')).not.toBeInTheDocument()
    expect(screen.queryByText(/No active nutrition plan/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Enter a manual base target' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Age (completed years)' }), '19')
    await user.type(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' }), '80')
    await user.type(screen.getByRole('spinbutton', { name: 'Manual base target (kcal/day)' }), '2400')
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    expect(await screen.findByRole('region', { name: 'Provisional daily target preview' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next: Weekday targets' }))
    await reviewedFlat()
    expect(screen.getByRole('region', { name: 'Provisional weekday targets' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(1)
    expect(callsTo(planFetch, '/api/nutrition/v1/plans')).toHaveLength(0)
    storageAvailable = true
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await user.click(screen.getByRole('tab', { name: 'History' }))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No saved plan versions yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Active plan' }))
    expect(await screen.findByText('No active nutrition plan. An unsaved calculator preview is not a plan.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Calculator' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Saved-plan status changed since this review')
    await user.click(screen.getByRole('button', { name: 'Back to weekdays' }))
    await reviewedFlat()
    await confirmZone(user)
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeEnabled()
  })

  it('keeps an existing saved average unchanged until a fresh calculation is explicitly replaced', async () => {
    const updatedPreview: PreviewResponse = {
      ...manualPreview,
      inputs: {
        method: 'manual_target_v1',
        age_years: 19,
        weight_kg: 80,
        manual_base_target_kcal: 2600,
        calorie_adjustment_kcal: 0,
        strategy: manualPreview.inputs.strategy,
      },
      base_target_kcal: 2600,
      daily_target: { ...manualPreview.daily_target, kcal: 2600, fat_g: 86.67, carbohydrate_g: 326.99 },
    }
    const newAllocation = {
      ...flatAllocation,
      chosen_average_kcal: 2600,
      weekly_total_kcal: 18200,
      weekdays: flatAllocation.weekdays.map((day) => ({ ...day, target: updatedPreview.daily_target })),
    }
    const { service, fetchMock: planFetch } = mockPlanService({ revision: 1, plan: savedPlan })
    service.allocation = (body) => {
      expect(body).toEqual({ accepted_preview: updatedPreview, weekday_kcal: Array(7).fill(2600) })
      return Response.json(newAllocation)
    }
    const updatedPlan: SavedPlan = {
      ...savedPlan, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2, started_at: '2026-09-29T17:00:00Z',
      accepted_preview: updatedPreview, chosen_average_kcal: 2600, weekly_total_kcal: 18200, weekdays: newAllocation.weekdays,
    }
    service.replace = (body) => {
      expect(body.accepted_preview).toEqual(updatedPreview)
      expect(body.weekday_kcal).toEqual(Array(7).fill(2600))
      expect(body.expected_revision).toBe(1)
      service.active = { revision: 2, plan: updatedPlan }
      service.history = { revision: 2, plans: [updatedPlan, { ...savedPlan, ended_at: '2026-09-29T17:00:00Z' }], next_before_version: null }
      return Response.json(service.active)
    }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/nutrition/v1/estimates/options') return Response.json(optionsFixture)
      if (url === '/api/nutrition/v1/estimates/preview' && init?.method === 'POST') return Response.json(updatedPreview)
      return planFetch(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const user = userEvent.setup()
    render(<QueryClientProvider client={client}><NutritionPage /></QueryClientProvider>)
    await screen.findByText(/Version 1 · Started/)
    expect(screen.getByText('Chosen daily target').parentElement).toHaveTextContent('2,400 kcal')
    await user.click(screen.getByRole('tab', { name: 'Calculator' }))
    await user.click(screen.getByRole('radio', { name: 'Enter a manual base target' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Age (completed years)' }), '19')
    await user.type(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' }), '80')
    await user.type(screen.getByRole('spinbutton', { name: 'Manual base target (kcal/day)' }), '2600')
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    await user.click(await screen.findByRole('button', { name: 'Next: Weekday targets' }))
    await reviewedFlat()
    expect(screen.getByRole('region', { name: 'Provisional weekday targets' })).toHaveTextContent('Chosen average: 2,600 kcal/day')
    await user.click(screen.getByRole('tab', { name: 'Active plan' }))
    expect(screen.getByText('Chosen daily target').parentElement).toHaveTextContent('2,400 kcal')
    await user.click(screen.getByRole('tab', { name: 'Calculator' }))
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
    await confirmZone(user)
    await user.click(await screen.findByRole('button', { name: 'Replace active plan' }))
    await screen.findByText(/Version 2 · Started/)
    expect(screen.getByText('Chosen daily target').parentElement).toHaveTextContent('2,600 kcal')
    expect(screen.getByText('Version 1 · Ended')).toBeInTheDocument()
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/nutrition/v1/estimates/preview')).toHaveLength(1)
  })

  it.each([
    ['below per kg', 80, { mode: 'per_kg', g_per_kg: 0.99 }, 79.2, true],
    ['above fixed grams', 80, { mode: 'daily_grams', g_per_day: 240.8 }, 240.8, true],
    ['decimal lower boundary', 70.1, { mode: 'daily_grams', g_per_day: 70.1 }, 70.1, false],
    ['decimal upper boundary', 70.1, { mode: 'daily_grams', g_per_day: 210.3 }, 210.3, false],
    ['just below decimal boundary', 70.1, { mode: 'daily_grams', g_per_day: 70.09999999999998 }, 70.1, true],
    ['just above decimal boundary', 70.1, { mode: 'daily_grams', g_per_day: 210.30000000000004 }, 210.3, true],
  ] satisfies [string, number, ProteinSelection, number, boolean][])('reviews and saves %s protein without an extra gate and discloses the unchanged snapshot', async (_label, weight, protein, dailyProtein, warns) => {
    const preview: PreviewResponse = {
      ...manualPreview,
      inputs: { ...manualPreview.inputs, weight_kg: weight, strategy: { ...manualPreview.inputs.strategy, protein } },
      daily_target: { ...manualPreview.daily_target, protein_g: dailyProtein, carbohydrate_g: (2400 - dailyProtein * 4 - 80 * 9) / 4 },
    }
    const allocation = { ...flatAllocation, weekdays: flatAllocation.weekdays.map((day) => ({ ...day, target: preview.daily_target })) }
    const { service, fetchMock } = mockPlanService()
    service.allocation = (body) => {
      expect(body.accepted_preview).toEqual(preview)
      return Response.json(allocation)
    }
    service.save = (body) => {
      expect(body).toEqual({
        accepted_preview: preview,
        weekday_kcal: Array(7).fill(2400),
        expected_revision: 0,
        time_zone: 'Europe/Oslo',
      })
      const plan: SavedPlan = { ...savedPlan, accepted_preview: preview, weekdays: allocation.weekdays }
      service.active = { revision: 1, plan }
      service.history = { revision: 1, plans: [plan], next_before_version: null }
      return Response.json(service.active, { status: 201 })
    }
    const user = userEvent.setup()
    renderPlans(preview)
    await screen.findByText('No active nutrition plan. An unsaved calculator preview is not a plan.')
    await reviewedFlat()
    expect(screen.queryByText(/Protein review: This protein choice is outside the 1-3 g\/kg\/day product review band/) !== null).toBe(warns)
    expect(screen.queryByRole('checkbox', { name: /server's day-level reasons/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await confirmZone(user)
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Save new plan' }))
    expect(await screen.findByText(/Nutrition plan version 1 saved/)).toBeInTheDocument()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans')).toHaveLength(1)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(1)
    await user.click(screen.getByText('About this saved calculation'))
    const active = within(screen.getByRole('region', { name: 'Active plan' }))
    const snapshot = within(active.getByRole('region', { name: 'Accepted daily target snapshot' }))
    expect(snapshot.queryByText(/outside the 1-3 g\/kg\/day product review band/) !== null).toBe(warns)
    await user.click(screen.getByText('View saved version 1 details'))
    const history = within(screen.getByRole('region', { name: 'Saved plan history' }))
    const historicalSnapshot = within(history.getByRole('region', { name: 'Accepted daily target snapshot' }))
    expect(historicalSnapshot.queryByText(/outside the 1-3 g\/kg\/day product review band/) !== null).toBe(warns)
    expect(service.active.plan?.accepted_preview).toEqual(preview)
  })

  it('discards unfinished calculator and weekday drafts when the keyed Clerk session changes', async () => {
    const { service } = mockWorkspace({ revision: 1, plan: savedPlan })
    service.readActive = () => Response.json(auth.userId === 'user-a' ? service.active : { revision: 0, plan: null })
    service.readHistory = () => Response.json(auth.userId === 'user-a' ? service.history : { revision: 0, plans: [], next_before_version: null })
    const user = userEvent.setup()
    const { client, view } = renderWorkspace()
    await screen.findByText(/Version 1 · Started/)
    await user.click(screen.getByRole('tab', { name: 'Calculator' }))
    await fillNewManual(user)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    await user.click(await screen.findByRole('button', { name: 'Next: Weekday targets' }))
    const monday = screen.getByRole('spinbutton', { name: 'Monday (kcal)' })
    await user.clear(monday)
    await user.type(monday, '2600')
    auth.userId = 'user-b'
    auth.sessionId = 'session-b'
    view.rerender(<QueryClientProvider client={client}><NutritionPage /></QueryClientProvider>)
    await screen.findByRole('form', { name: 'Nutrition preview' })
    expect(screen.getByRole('tab', { name: 'Calculator' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' })).toHaveValue(null)
    expect(screen.getByRole('radio', { name: 'Enter a manual base target' })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Continue to accepted preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'Monday (kcal)' })).not.toBeInTheDocument()
    expect(screen.queryByText('Version 1 · Active')).not.toBeInTheDocument()
  })

  it('discards the prior saved-plan UI and queries on a Clerk user/session switch', async () => {
    const { service, fetchMock: planFetch } = mockPlanService({ revision: 1, plan: savedPlan })
    service.readActive = () => Response.json(auth.userId === 'user-a' ? service.active : { revision: 0, plan: null })
    service.readHistory = () => Response.json(auth.userId === 'user-a' ? service.history : { revision: 0, plans: [], next_before_version: null })
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url === '/api/nutrition/v1/estimates/options' ? Promise.resolve(Response.json(optionsFixture)) : planFetch(url, init)))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const renderPage = () => <QueryClientProvider client={client}><NutritionPage /></QueryClientProvider>
    const page = render(renderPage())
    expect(await screen.findByText('Version 1 · Active')).toBeInTheDocument()
    auth.userId = 'different-user'
    auth.sessionId = 'session-b'
    page.rerender(renderPage())
    expect(screen.queryByText('Version 1 · Active')).not.toBeInTheDocument()
    expect(await screen.findByText('No saved plan versions yet.')).toBeInTheDocument()
    expect(screen.getByText('No active nutrition plan. An unsaved calculator preview is not a plan.')).toBeInTheDocument()
    expect(await screen.findByRole('form', { name: 'Nutrition preview' })).toBeInTheDocument()
  })

  it('keeps the active tab and the end result visible after the refetch confirms no plan, without depending on button focus', async () => {
    const { service, planFetch } = mockWorkspace({ revision: 1, plan: savedPlan })
    service.end = ({ expected_revision }) => {
      expect(expected_revision).toBe(1)
      service.active = { revision: 2, plan: null }
      service.history = { revision: 2, plans: [{ ...savedPlan, ended_at: '2026-09-29T17:00:00Z' }], next_before_version: null }
      return Response.json(service.active)
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWorkspace()
    await screen.findByText(/Version 1 · Started/)
    expect(screen.getByRole('tab', { name: 'Active plan' })).toHaveAttribute('aria-selected', 'true')
    // A tap that never moves DOM focus, as on iOS Safari, must not let the refetched status move the tab.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End plan' })) })
    expect(await screen.findByText('Nutrition plan ended. Its saved history remains available.')).toBeVisible()
    await screen.findByText('No active nutrition plan. An unsaved calculator preview is not a plan.')
    await waitFor(() => expect(callsTo(planFetch, '/api/nutrition/v1/plans/active')).toHaveLength(2))
    expect(screen.getByRole('tab', { name: 'Active plan' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Nutrition plan ended. Its saved history remains available.')).toBeVisible()
  })

  it('keeps expanded saved history and the active plan on screen while a refresh is in flight', async () => {
    let releaseActive!: (response: Response) => void
    let releaseHistory!: (response: Response) => void
    const pendingActive = new Promise<Response>((resolve) => { releaseActive = resolve })
    const pendingHistory = new Promise<Response>((resolve) => { releaseHistory = resolve })
    const { service } = mockPlanService({ revision: 1, plan: savedPlan })
    const user = userEvent.setup()
    const { client } = renderPlans(null)
    expect(await screen.findByText('Version 1 · Active')).toBeInTheDocument()
    await user.click(screen.getByText('View saved version 1 details'))
    expect(screen.getByRole('region', { name: 'Version 1 saved targets' })).toHaveTextContent('Monday')
    service.readActive = () => pendingActive
    service.readHistory = () => pendingHistory
    await act(async () => { void client.invalidateQueries({ queryKey: ['nutrition', 'plans'] }); await Promise.resolve() })
    await waitFor(() => expect(screen.getByText('Loading saved plan history…')).toBeInTheDocument())
    expect(screen.getByText('Loading saved plan and revision…')).toBeInTheDocument()
    expect(screen.getByText('Version 1 · Active')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Version 1 saved targets' })).toHaveTextContent('Monday')
    expect(screen.getByRole('region', { name: 'Saved weekday targets' })).toBeInTheDocument()
    await act(async () => {
      releaseActive(Response.json(service.active))
      releaseHistory(Response.json(service.history))
      await Promise.all([pendingActive, pendingHistory])
    })
    await waitFor(() => expect(screen.queryByText('Loading saved plan history…')).not.toBeInTheDocument())
    expect(screen.getByRole('region', { name: 'Version 1 saved targets' })).toHaveTextContent('Monday')
  })

  it('makes ending unavailable while a failed refresh leaves only cached plan content, and restores it after recovery', async () => {
    const activeKey = ['nutrition', 'plans', 'active', 'user-a', 'session-a']
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: savedPlan })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    const { client } = renderPlans(null)
    await waitFor(() => expect(screen.getByRole('button', { name: 'End plan' })).toBeEnabled())
    service.readActive = () => failure(503, 'Plan storage is not configured')
    await act(async () => { void client.invalidateQueries({ queryKey: activeKey }); await Promise.resolve() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'End plan' })).toBeDisabled())
    expect(screen.getByRole('heading', { name: 'Saved plan unavailable' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Saved weekday targets' })).toBeInTheDocument()
    expect(screen.getByText(/Ending this plan needs a confirmed active revision/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'End plan' })).toHaveAccessibleDescription(/Ending this plan needs a confirmed active revision/)
    expect(screen.getByRole('button', { name: 'Edit weekdays' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'New calculation' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'End plan' }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/end')).toHaveLength(0)
    expect(screen.queryByText(/Nutrition plan ended/)).not.toBeInTheDocument()
    service.readActive = undefined
    await act(async () => { void client.invalidateQueries({ queryKey: activeKey }); await Promise.resolve() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'End plan' })).toBeEnabled())
    expect(screen.queryByText(/Ending this plan needs a confirmed active revision/)).not.toBeInTheDocument()
  })

  it('does not report a changed saved-plan status or block saving while the active read is only refetching', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const { service } = mockPlanService()
    const user = userEvent.setup()
    const { client } = renderPlans()
    await reviewedFlat()
    await confirmZone(user)
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeEnabled()
    service.readActive = () => pending
    await act(async () => { void client.invalidateQueries({ queryKey: ['nutrition', 'plans', 'active', 'user-a', 'session-a'] }); await Promise.resolve() })
    await waitFor(() => expect(screen.getByText('Loading saved plan and revision…')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/Saved-plan status and revision must load before saving/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeEnabled()
    await act(async () => { release(Response.json(service.active)); await pending })
    await waitFor(() => expect(screen.queryByText('Loading saved plan and revision…')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the accepted preview, weekday draft and confirmed zone when a starting-options refresh fails', async () => {
    let optionsAttempt = 0
    const { service, planFetch } = mockWorkspace()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === '/api/nutrition/v1/estimates/options') {
        optionsAttempt += 1
        return optionsAttempt === 1 ? Response.json(optionsFixture) : failure(503, 'Starting suggestions are unavailable', 'options-id')
      }
      if (url === '/api/nutrition/v1/estimates/preview' && init?.method === 'POST') return Response.json(manualPreview)
      return planFetch(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    service.save = (body) => {
      expect(body.expected_revision).toBe(0)
      expect(body.accepted_preview).toEqual(manualPreview)
      expect(body.weekday_kcal).toEqual([2600, 2400, 2400, 2400, 2400, 2400, 2200])
      expect(body.time_zone).toBe('Europe/Berlin')
      service.active = { revision: 1, plan: savedPlan }
      service.history = { revision: 1, plans: [savedPlan], next_before_version: null }
      return Response.json(service.active, { status: 201 })
    }
    const user = userEvent.setup()
    const { client } = renderWorkspace()
    await fillNewManual(user)
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    await user.click(await screen.findByRole('button', { name: 'Next: Weekday targets' }))
    const monday = screen.getByRole('spinbutton', { name: 'Monday (kcal)' })
    await user.clear(monday)
    await user.type(monday, '2600')
    const sunday = screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })
    await user.clear(sunday)
    await user.type(sunday, '2200')
    const next = await screen.findByRole('button', { name: 'Next: Review and save' })
    await waitFor(() => expect(next).toBeEnabled())
    await user.click(next)
    await screen.findByRole('region', { name: 'Provisional weekday targets' })
    await confirmZone(user, 'Europe/Berlin')
    await user.click(screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ }))
    await act(async () => { await client.invalidateQueries({ queryKey: ['nutrition', 'options', 'user-a', 'session-a'] }) })
    expect(await screen.findByText('Request ID: options-id')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Provisional weekday targets' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' })).toHaveValue('Europe/Berlin')
    expect(screen.getByRole('checkbox', { name: /I confirm this IANA calendar time zone/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save new plan' }))
    expect(await screen.findByText(/Nutrition plan version 1 saved/)).toBeInTheDocument()
    expect(callsTo(planFetch, '/api/nutrition/v1/plans')).toHaveLength(1)
  })
})
