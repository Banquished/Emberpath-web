import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveAllocationPreviewRequest, ActivePlanResponse, AllocationPreviewRequest, PlanHistoryResponse, SavePlanRequest, SavedPlan } from '@/entities/nutrition-plan'
import type { PreviewOptions, PreviewResponse } from '@/entities/nutrition-preview'
import { NutritionPage } from './nutrition-page'
import { NutritionPlans, type PlanEditorMode } from './nutrition-plans'
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

function renderPlans(preview: PreviewResponse | null = manualPreview, initialMode: PlanEditorMode = preview ? 'new' : null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  function Harness() {
    const [accepted, setAccepted] = useState(preview)
    const [mode, setMode] = useState(initialMode)
    return <QueryClientProvider client={client}>
      <NutritionPlans acceptedPreview={accepted} previewRevision={1} mode={mode} onModeChange={setMode} onConfirmedSave={() => { setAccepted(null); setMode(null) }} />
    </QueryClientProvider>
  }
  const view = render(<Harness />)
  return { client, view }
}

async function reviewedFlat() {
  return within(await screen.findByRole('region', { name: 'Provisional weekday targets' }))
}

beforeEach(() => {
  Object.assign(auth, { isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'session-a' })
  auth.getToken.mockReset().mockResolvedValue('test-token')
})
afterEach(() => vi.restoreAllMocks())

describe('Nutrition plan review and persistence', () => {
  it('starts flat, uses a complete unchanged accepted preview, and waits for an active revision before saving', async () => {
    let releaseActive!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { releaseActive = resolve })
    const { service, fetchMock } = mockPlanService()
    service.readActive = (attempt) => attempt === 1 ? pending : Response.json(service.active)
    renderPlans()
    const review = await reviewedFlat()
    expect(review.getByText('Chosen average: 2,400 kcal/day. Planned full-week total: 16,800 kcal. These are targets, not food consumed.')).toBeInTheDocument()
    expect(review.getAllByText('2,400 kcal')).toHaveLength(7)
    expect(review.getByText('Monday').parentElement).toHaveTextContent('Protein128 g')
    expect(review.getByText('Sunday').parentElement).toHaveTextContent('Fibre25 g')
    expect(screen.getByText('Remaining allocation: 0 kcal. The week is balanced.')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    const allocationCall = callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')[0]!
    expect(JSON.parse(allocationCall[1]!.body as string)).toEqual({ accepted_preview: manualPreview, weekday_kcal: Array(7).fill(2400) })
    await act(async () => { releaseActive(Response.json({ revision: 0, plan: null })); await pending })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save new plan' })).toBeEnabled())
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans')).toHaveLength(0)
  })

  it('shows remaining kcal without changing another day, derives targets on the server, and resets risk acknowledgment after edits', async () => {
    const { fetchMock } = mockPlanService()
    const user = userEvent.setup()
    renderPlans()
    await reviewedFlat()
    const monday = screen.getByRole('spinbutton', { name: 'Monday (kcal)' })
    const sunday = screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })
    await user.clear(monday)
    await user.type(monday, '2600')
    expect(screen.getByText('Remaining allocation: -200 kcal. Adjust a weekday; no other day changes automatically.')).toBeInTheDocument()
    expect(sunday).toHaveValue(2400)
    expect(screen.queryByRole('region', { name: 'Provisional weekday targets' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await user.clear(sunday)
    await user.type(sunday, '2200')
    const review = within(await screen.findByRole('region', { name: 'Provisional weekday targets' }))
    expect(review.getByText('Monday').parentElement).toHaveTextContent('Calories2,600 kcalVs average+200 kcalProtein128 gFat86.67 gCarbohydrate326.99 gFibre25 g')
    expect(review.getByText('Sunday').parentElement).toHaveTextContent('Calories2,200 kcalVs average-200 kcalProtein128 gFat73.33 gCarbohydrate257.01 gFibre25 g')
    expect(screen.getByText(/Some weekday targets differ from the chosen average/)).toBeInTheDocument()
    const acknowledgment = screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })
    expect(acknowledgment).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await user.click(acknowledgment)
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeEnabled()
    await user.type(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }), 'a')
    expect(acknowledgment).not.toBeChecked()
    await user.click(acknowledgment)
    await user.clear(sunday)
    await user.type(sunday, '2199')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await user.clear(sunday)
    await user.type(sunday, '2200')
    expect(await screen.findByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })).not.toBeChecked()
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
    expect(screen.getByRole('checkbox')).not.toBeChecked()
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
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    const sunday = screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })
    await user.clear(sunday)
    await user.type(sunday, '2200')
    expect((await reviewedFlat()).getByText('Monday').parentElement).toHaveTextContent('2,600 kcal')
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(2)
  })

  it('keeps a balanced but infeasible server allocation error visible and never offers a save as a safety override', async () => {
    const { service } = mockPlanService()
    service.allocation = () => failure(422, 'Weekday target cannot accommodate chosen protein, fat and fibre', 'infeasible-id')
    renderPlans()
    expect(await screen.findByRole('alert')).toHaveTextContent('Weekday target cannot accommodate chosen protein, fat and fibre')
    expect(screen.getByText('Request ID: infeasible-id')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
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
    await reviewedFlat()
    const zone = screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' })
    await user.clear(zone)
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    await user.type(zone, 'Europe/Oslo')
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
    await reviewedFlat()
    expect(screen.getByRole('heading', { name: 'Review a replacement plan' })).toBeInTheDocument()
    expect(screen.getByText(/To change the average, calculate a fresh preview and explicitly replace/)).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }))
    await user.type(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }), 'Europe/Oslo')
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
    expect(await screen.findByRole('button', { name: 'Edit saved weekday allocation' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Edit saved weekday allocation' }))
    expect(screen.getByRole('heading', { name: 'Edit saved weekday allocation' })).toBeInTheDocument()
    expect(screen.getByText(/reviews the active saved snapshot from version 1 without recalculating its historical estimate/)).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Monday (kcal)' })).toHaveValue(2600)
    expect(screen.getByRole('spinbutton', { name: 'Sunday (kcal)' })).toHaveValue(2200)
    expect(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' })).toHaveValue('Europe/Oslo')
    await reviewedFlat()
    const ack = screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })
    expect(ack).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    await user.click(ack)
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
    await user.click(await screen.findByRole('button', { name: 'Edit saved weekday allocation' }))
    expect((await reviewedFlat()).getByText('Current neutral allocation notice.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })).not.toBeChecked()
    expect(callsTo(fetchMock, `/api/nutrition/v1/plans/${original.id}/allocations/preview`)).toHaveLength(1)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(0)
    await user.click(screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ }))
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
    await user.click(await screen.findByRole('button', { name: 'Edit saved weekday allocation' }))
    expect(await screen.findByRole('heading', { name: 'Saved allocation review is stale' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(status === 404 ? 'This saved plan could not be found.' : detail)
    expect(screen.getByText('Request ID: stale-review-id')).toBeInTheDocument()
    expect(screen.getByText(/Refresh the active plan and history, then review its weekday allocation again/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Monday (kcal)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
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
    expect(screen.queryByRole('heading', { name: 'Edit saved weekday allocation' })).not.toBeInTheDocument()
    expect(callsTo(fetchMock, `/api/nutrition/v1/plans/${savedPlan.id}/allocations/preview`)).toHaveLength(1)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active').length).toBeGreaterThan(1)
    expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/nutrition/v1/plans?')).length).toBeGreaterThan(1)
    await user.click(screen.getByRole('button', { name: 'Edit saved weekday allocation' }))
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
    await user.click(await screen.findByRole('button', { name: 'Edit saved weekday allocation' }))
    await waitFor(() => expect(callsTo(fetchMock, `/api/nutrition/v1/plans/${savedPlan.id}/allocations/preview`)).toHaveLength(1))
    const latest: SavedPlan = { ...savedPlan, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2 }
    service.active = { revision: 2, plan: latest }
    await act(async () => { await client.invalidateQueries({ queryKey: ['nutrition', 'plans', 'active', 'user-a', 'session-a'] }) })
    expect(await screen.findByText(/Version 2 · Started/)).toBeInTheDocument()
    await act(async () => { release(Response.json(unevenAllocation)); await pending })
    expect(screen.queryByRole('region', { name: 'Provisional weekday targets' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('This saved plan is no longer active')
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(0)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
  })

  it('does not fall back to DB-free allocation if the active plan read fails during a saved edit', async () => {
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: savedPlan })
    const user = userEvent.setup()
    const { client } = renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit saved weekday allocation' }))
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
    await user.click(await screen.findByRole('button', { name: 'Edit saved weekday allocation' }))
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByText('Request ID: active-error-id')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(0)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
  })

  it('shows storage-unavailable 503 as a failed save with its request ID and leaves active/history unchanged', async () => {
    const { service, fetchMock } = mockPlanService()
    const user = userEvent.setup()
    renderPlans()
    await reviewedFlat()
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
    await user.click(await screen.findByRole('button', { name: 'Edit saved weekday allocation' }))
    await reviewedFlat()
    const ack = screen.getByRole('checkbox', { name: /I have reviewed the server's day-level reasons/ })
    expect(ack).not.toBeChecked()
    await user.click(ack)
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
    await user.click(screen.getByText('View saved version 1 weekday targets'))
    expect(screen.getByRole('region', { name: 'Version 1 saved targets' })).toHaveTextContent('Monday')
    await user.click(screen.getByRole('button', { name: 'End active plan' }))
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/end')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'End active plan' }))
    expect(await screen.findByText('Nutrition plan ended. Its saved history remains available.')).toBeInTheDocument()
    expect(await screen.findByText('No active nutrition plan. An unsaved calculator preview is not a plan.')).toBeInTheDocument()
    expect(await screen.findByText('Version 2 · Ended')).toBeInTheDocument()
    expect(screen.getByText('Version 1 · Ended')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/end')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('before_version=2')).length).toBeGreaterThan(1)
  })

  it('keeps an active plan unchanged on a 409 revision conflict, then refreshes instead of resubmitting stale data', async () => {
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: savedPlan })
    const user = userEvent.setup()
    service.replace = () => failure(409, 'Plan revision does not match', 'conflict-id')
    renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit saved weekday allocation' }))
    await reviewedFlat()
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
    expect(screen.queryByRole('heading', { name: 'Edit saved weekday allocation' })).not.toBeInTheDocument()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(1)
  })

  it('blocks edits to a saved version that stopped being active during an in-flight review', async () => {
    const { service, fetchMock } = mockPlanService({ revision: 1, plan: savedPlan })
    const user = userEvent.setup()
    const { client } = renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit saved weekday allocation' }))
    await reviewedFlat()
    const latest = { ...savedPlan, id: 'c83c82c3-f14c-429a-a89c-62f79c994be7', version: 2 }
    service.active = { revision: 2, plan: latest }
    await act(async () => { await client.invalidateQueries({ queryKey: ['nutrition', 'plans', 'active', 'user-a', 'session-a'] }) })
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active')).toHaveLength(2)
    expect(await screen.findByText(/Version 2 · Started/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('This saved plan is no longer active')
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Refresh saved plan' }))
    expect(await screen.findByText(/Version 2 · Started/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Edit saved weekday allocation' })).not.toBeInTheDocument()
    expect(callsTo(fetchMock, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
  })

  it('reports a 422 write or end rejection without a success notice or invented lifecycle transition', async () => {
    const { service } = mockPlanService({ revision: 1, plan: savedPlan })
    service.replace = () => failure(422, 'Invalid IANA time zone', 'zone-id')
    service.end = () => failure(422, 'Invalid request', 'end-id')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderPlans(null)
    await user.click(await screen.findByRole('button', { name: 'Edit saved weekday allocation' }))
    await reviewedFlat()
    await user.clear(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }))
    await user.type(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }), 'Invalid/Zone')
    expect(screen.getByText('Enter a valid IANA time zone.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace active plan' })).toBeDisabled()
    await user.clear(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }))
    await user.type(screen.getByRole('textbox', { name: 'Plan calendar time zone (IANA)' }), 'Europe/Oslo')
    await user.click(screen.getByRole('button', { name: 'Replace active plan' }))
    expect(await screen.findByRole('heading', { name: 'Plan was not saved: check your inputs' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid IANA time zone')
    expect(screen.getByText('Request ID: zone-id')).toBeInTheDocument()
    expect(screen.queryByText(/Nutrition plan version 2 saved/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Leave without saving' }))
    await user.click(screen.getByRole('button', { name: 'End active plan' }))
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
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
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
    expect(await screen.findByRole('region', { name: 'Provisional weekday targets' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save new plan' })).toBeDisabled()
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/allocations/preview')).toHaveLength(1)
    expect(callsTo(planFetch, '/api/nutrition/v1/plans')).toHaveLength(0)
    storageAvailable = true
    const retryButtons = screen.getAllByRole('button', { name: 'Retry' })
    expect(retryButtons).toHaveLength(2)
    await user.click(retryButtons[0]!)
    await user.click(retryButtons[1]!)
    expect(await screen.findByText('No saved plan versions yet.')).toBeInTheDocument()
    expect(await screen.findByText('No active nutrition plan. An unsaved calculator preview is not a plan.')).toBeInTheDocument()
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
    expect(await screen.findByText(/Version 1 · Started/)).toHaveTextContent('Daily average 2,400 kcal')
    await user.click(screen.getByRole('radio', { name: 'Enter a manual base target' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Age (completed years)' }), '19')
    await user.type(screen.getByRole('spinbutton', { name: 'Manually entered weight (kg)' }), '80')
    await user.type(screen.getByRole('spinbutton', { name: 'Manual base target (kcal/day)' }), '2600')
    await user.click(screen.getByRole('button', { name: 'Preview daily targets' }))
    expect(await screen.findByRole('region', { name: 'Provisional weekday targets' })).toHaveTextContent('Chosen average: 2,600 kcal/day')
    expect(screen.getByText(/Version 1 · Started/)).toHaveTextContent('Daily average 2,400 kcal')
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(0)
    await user.click(await screen.findByRole('button', { name: 'Replace active plan' }))
    expect(await screen.findByText(/Version 2 · Started/)).toHaveTextContent('Daily average 2,600 kcal')
    expect(screen.getByText('Version 1 · Ended')).toBeInTheDocument()
    expect(callsTo(planFetch, '/api/nutrition/v1/plans/active/replacements')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/nutrition/v1/estimates/preview')).toHaveLength(1)
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
})
