import { describe, expect, it, vi } from 'vitest'
import type { ActiveAllocationPreviewRequest, SavePlanRequest } from '@/entities/nutrition-plan'
import { dayNotice, flatAllocation, manualPreview, savedPlan } from '../test/plan-fixtures'
import { endNutritionPlan, getActivePlan, getPlanHistory, previewActivePlanAllocation, previewPlanAllocation, replaceNutritionPlan, saveNutritionPlan } from './nutrition-plans'

const token = async () => 'test-token'
const saveRequest: SavePlanRequest = { expected_revision: 0, accepted_preview: manualPreview, time_zone: 'Europe/Oslo', weekday_kcal: [2400, 2400, 2400, 2400, 2400, 2400, 2400] }
const activeAllocationRequest: ActiveAllocationPreviewRequest = { expected_revision: 1, weekday_kcal: [2400, 2400, 2400, 2400, 2400, 2400, 2400] }

function failed(status: number, detail: string, requestId = 'plan-request-id') {
  return Response.json({ detail, request_id: requestId }, { status, headers: { 'X-Request-ID': requestId } })
}

describe('authenticated Nutrition plan API', () => {
  it('sends the complete accepted preview and seven weekdays only to the DB-free allocation endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(flatAllocation))
    vi.stubGlobal('fetch', fetchMock)
    expect(await previewPlanAllocation(token, { accepted_preview: manualPreview, weekday_kcal: saveRequest.weekday_kcal })).toEqual(flatAllocation)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/nutrition/v1/plans/allocations/preview')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ accepted_preview: manualPreview, weekday_kcal: saveRequest.weekday_kcal })
  })

  it('reviews the active snapshot by ID/revision without sending an accepted preview', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(flatAllocation))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    expect(await previewActivePlanAllocation(token, savedPlan.id, activeAllocationRequest, controller.signal)).toEqual(flatAllocation)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/nutrition/v1/plans/${savedPlan.id}/allocations/preview`)
    expect(init.method).toBe('POST')
    expect(init.signal).toBe(controller.signal)
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${await token()}`)
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual(activeAllocationRequest)
    expect(init.body).not.toContain('accepted_preview')
  })

  it.each([
    [401, 'Invalid or missing session', 'authentication'],
    [403, 'Forbidden', 'forbidden'],
    [404, 'Plan not found', 'not-found'],
    [409, 'Plan revision does not match', 'conflict'],
    [422, 'Weekday target cannot accommodate chosen protein, fat and fibre', 'invalid'],
    [503, 'Plan storage is not configured', 'storage'],
  ] as const)('reports active-allocation %i without falling back to stateless review', async (status, detail, kind) => {
    const fetchMock = vi.fn().mockResolvedValue(failed(status, detail, 'snapshot-id'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(previewActivePlanAllocation(token, savedPlan.id, activeAllocationRequest)).rejects.toMatchObject({ kind, requestId: 'snapshot-id' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/nutrition/v1/plans/${savedPlan.id}/allocations/preview`)
  })

  it('requires a session and rejects malformed active-allocation responses without fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...flatAllocation, weekdays: [] }, { headers: { 'X-Request-ID': 'malformed-id' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(previewActivePlanAllocation(async () => null, savedPlan.id, activeAllocationRequest)).rejects.toMatchObject({ kind: 'authentication' })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(previewActivePlanAllocation(token, savedPlan.id, activeAllocationRequest)).rejects.toMatchObject({ kind: 'service', requestId: 'malformed-id' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads the active revision and paginated history without inventing an empty plan', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ revision: 0, plan: null }))
      .mockResolvedValueOnce(Response.json({ revision: 2, plans: [savedPlan], next_before_version: 1 }))
      .mockResolvedValueOnce(Response.json({ revision: 2, plans: [], next_before_version: null }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getActivePlan(token)).toEqual({ revision: 0, plan: null })
    expect((await getPlanHistory(token)).plans).toEqual([savedPlan])
    expect((await getPlanHistory(token, 1)).plans).toEqual([])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/nutrition/v1/plans/active',
      '/api/nutrition/v1/plans?limit=10',
      '/api/nutrition/v1/plans?limit=10&before_version=1',
    ])
  })

  it('requires 201 for a new save, 200 for a replacement, and a confirmed null plan on end', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ revision: 1, plan: savedPlan }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ revision: 2, plan: { ...savedPlan, version: 2 } }))
      .mockResolvedValueOnce(Response.json({ revision: 3, plan: null }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await saveNutritionPlan(token, saveRequest)).plan?.version).toBe(1)
    const replacement: SavePlanRequest = { ...saveRequest, expected_revision: 1, acknowledge_day_allocation_risk: true }
    expect((await replaceNutritionPlan(token, replacement)).revision).toBe(2)
    expect(await endNutritionPlan(token, 2)).toEqual({ revision: 3, plan: null })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/nutrition/v1/plans', '/api/nutrition/v1/plans/active/replacements', '/api/nutrition/v1/plans/active/end',
    ])
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual(saveRequest)
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual(replacement)
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({ expected_revision: 2 })
  })

  it.each([
    [401, 'Invalid or missing session', 'authentication'],
    [403, 'Forbidden', 'forbidden'],
    [409, 'Plan revision does not match', 'conflict'],
    [422, 'Weekday target cannot accommodate chosen protein, fat and fibre', 'invalid'],
    [503, 'Plan storage is not configured', 'storage'],
    [503, 'Authentication unavailable', 'unavailable'],
  ] as const)('reports %i %s with request ID, never as a saved plan', async (status, detail, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failed(status, detail)))
    await expect(saveNutritionPlan(token, saveRequest)).rejects.toMatchObject({ kind, requestId: 'plan-request-id' })
  })

  it('does not send a plan request without a session token or accept a malformed write response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ revision: 1, plan: null }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ revision: 2, plan: savedPlan }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ chosen_average_kcal: 2400, weekly_total_kcal: 16800, weekdays: [], risk_reasons: [], acknowledgment_required: false, notice: dayNotice }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getActivePlan(async () => null)).rejects.toMatchObject({ kind: 'authentication' })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(saveNutritionPlan(token, saveRequest)).rejects.toMatchObject({ kind: 'service', message: 'The nutrition service returned an invalid response.' })
    await expect(replaceNutritionPlan(token, saveRequest)).rejects.toMatchObject({ kind: 'service', message: 'The nutrition service returned an unexpected success status.' })
    await expect(previewPlanAllocation(token, { accepted_preview: manualPreview })).rejects.toMatchObject({ kind: 'service', message: 'The nutrition service returned an invalid response.' })
  })
})
