import { describe, expect, it, vi } from 'vitest'
import { getNutritionOptions, NutritionRequestError, previewNutrition } from './nutrition-estimates'

const token = async () => 'test-token'
const manualInput = {
  method: 'manual_target_v1' as const,
  age_years: 19,
  weight_kg: 80,
  manual_base_target_kcal: 2400,
  calorie_adjustment_kcal: 0,
  strategy: { protein: { mode: 'per_kg' as const, g_per_kg: 1.6 }, fat_share: 0.3, fibre_g_per_day: 25 },
}

describe('nutrition API boundary', () => {
  it('does not contact the service without a token', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getNutritionOptions(async () => null)).rejects.toMatchObject({ kind: 'authentication' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'Missing or invalid Clerk session', 'authentication'],
    [403, 'Forbidden', 'forbidden'],
    [422, 'Age under 19 is not supported', 'invalid'],
    [503, 'Authentication unavailable', 'unavailable'],
    [500, 'Unexpected server error', 'service'],
  ] as const)('maps a %i error to a nutrition-specific failure with the request ID', async (status, detail, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(
      { detail, request_id: 'body-id' },
      { status, headers: { 'X-Request-ID': 'header-id' } },
    )))
    const error = await previewNutrition(token, manualInput).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(NutritionRequestError)
    expect(error).toMatchObject({ kind, requestId: 'header-id' })
    if (status === 422) expect(error).toHaveProperty('message', detail)
    else expect((error as Error).message).not.toContain(detail)
  })

  it('uses the JSON request ID when the header is unavailable and never treats malformed errors as success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ detail: 'Invalid request', request_id: 'body-only' }, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ message: 'Bad response' }, { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(previewNutrition(token, manualInput)).rejects.toMatchObject({ kind: 'invalid', requestId: 'body-only', message: 'Invalid request. Check your inputs and try again.' })
    await expect(getNutritionOptions(token)).rejects.toMatchObject({ kind: 'service', message: 'The nutrition service returned an invalid error response.' })
  })

  it('keeps a cancelled request distinct from a nutrition network failure', async () => {
    const cancelled = new DOMException('Aborted', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValueOnce(cancelled).mockRejectedValueOnce(new TypeError('Network error'))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    await expect(getNutritionOptions(token, controller.signal)).rejects.toBe(cancelled)
    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal)
    await expect(getNutritionOptions(token)).rejects.toMatchObject({ kind: 'network', message: 'Cannot reach the nutrition service. Check your connection and try again.' })
  })

  it('reports empty success responses rather than inventing options', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await expect(getNutritionOptions(token)).rejects.toMatchObject({ kind: 'service', message: 'The nutrition service returned an empty response.' })
  })

  it('rejects malformed options, mismatched previews and unexpected success statuses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ methods: [] }, { headers: { 'X-Request-ID': 'bad-options' } }))
      .mockResolvedValueOnce(Response.json({ method: 'nasem_2023_adult_tee' }, { headers: { 'X-Request-ID': 'bad-preview' } }))
      .mockResolvedValueOnce(Response.json({}, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getNutritionOptions(token)).rejects.toMatchObject({ kind: 'service', requestId: 'bad-options', message: 'The nutrition service returned an invalid response.' })
    await expect(previewNutrition(token, manualInput)).rejects.toMatchObject({ kind: 'service', requestId: 'bad-preview', message: 'The nutrition service returned an invalid response.' })
    await expect(previewNutrition(token, manualInput)).rejects.toMatchObject({ kind: 'service', message: 'The nutrition service returned an unexpected success status.' })
  })
})
