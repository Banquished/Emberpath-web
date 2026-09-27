import { afterEach, expect, it, vi } from 'vitest'
import { requestWeight } from './weight-request'

afterEach(() => vi.unstubAllGlobals())

it('does not send a request without a session token', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  await expect(requestWeight(async () => null, '/api/weight-logs')).rejects.toThrow('Your session has expired')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('preserves aborted requests instead of reporting a network failure', async () => {
  const cancelled = new DOMException('The request was aborted', 'AbortError')
  const fetchMock = vi.fn().mockRejectedValue(cancelled)
  vi.stubGlobal('fetch', fetchMock)
  const controller = new AbortController()
  controller.abort()

  await expect(requestWeight(async () => 'test-token', '/api/weight-logs', { signal: controller.signal })).rejects.toBe(cancelled)
  expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal)
})

it('distinguishes network failures from expired sessions', async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Network error')).mockResolvedValueOnce(new Response(null, { status: 401 }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(requestWeight(async () => 'test-token', '/api/weight-logs')).rejects.toThrow('Cannot reach the weight service')
  await expect(requestWeight(async () => 'test-token', '/api/weight-logs')).rejects.toThrow('Your session has expired')
})
