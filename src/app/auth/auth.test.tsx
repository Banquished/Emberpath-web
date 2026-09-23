import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PropsWithChildren } from 'react'
import { useDeleteWeightLog, useSaveWeightLog, useWeightLogs, useWeightSummary, useWeightRollingAverage } from '@/features/weight/api/weight-logs'
import { RequireAuth } from './require-auth'
import { SessionProvider } from './session-provider'

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'session-a', getToken: vi.fn<() => Promise<string | null>>() }))
vi.mock('@clerk/react', () => ({
  useAuth: () => auth,
  SignInButton: ({ children }: PropsWithChildren) => children,
  SignUpButton: ({ children }: PropsWithChildren) => children,
}))

beforeEach(() => {
  Object.assign(auth, { isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'session-a' })
  auth.getToken.mockReset().mockResolvedValue('token-a')
})

function wrapper({ children }: PropsWithChildren) {
  return <SessionProvider>{children}</SessionProvider>
}
function History() {
  const history = useWeightLogs()
  return <p>{history.data?.[0]?.date ?? 'No private data'}</p>
}

describe('authenticated journal', () => {
  it('does not mount or fetch the journal while loading or signed out', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    auth.isLoaded = false
    const view = render(<SessionProvider><RequireAuth><History /></RequireAuth></SessionProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('Loading your account')
    auth.isLoaded = true
    auth.isSignedIn = false
    view.rerender(<SessionProvider><RequireAuth><History /></RequireAuth></SessionProvider>)
    expect(screen.getByRole('heading', { name: 'Your weight journal' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(auth.getToken).not.toHaveBeenCalled()
  })

  it('sends current Bearer tokens on list, create, edit and delete', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => ({ list: useWeightLogs(), save: useSaveWeightLog(), remove: useDeleteWeightLog() }), { wrapper })
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    auth.getToken.mockResolvedValue('token-refreshed')
    const input = { date: '2026-09-20', weight_kg: 82.5 }
    await act(async () => { await result.current.save.mutateAsync({ input }) })
    await act(async () => { await result.current.save.mutateAsync({ id: 'one', input }) })
    await act(async () => { await result.current.remove.mutateAsync('one') })
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('Authorization')).toBe('Bearer token-a')
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const call = fetchMock.mock.calls.find(([, options]) => options.method === method)!
      expect(new Headers(call[1].headers).get('Authorization')).toBe('Bearer token-refreshed')
      if (method !== 'DELETE') expect(new Headers(call[1].headers).get('Content-Type')).toBe('application/json')
    }
  })

  it('fails closed when no session token is available', async () => {
    auth.getToken.mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useWeightLogs(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toContain('Sign in again')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports expired sessions without retrying unauthorized API calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useWeightLogs(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toContain('Sign in again')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('destroys the old cache and private component state on an account switch', () => {
    const clients: QueryClient[] = []
    function CacheProbe() {
      const client = useQueryClient()
      if (!clients.includes(client)) clients.push(client)
      return <span>{client.getQueryData<string>(['private']) ?? 'Empty cache'}</span>
    }
    const view = render(<SessionProvider><CacheProbe /></SessionProvider>)
    clients[0]!.setQueryData(['private'], 'Previous account data')
    view.rerender(<SessionProvider><CacheProbe /></SessionProvider>)
    expect(screen.getByText('Previous account data')).toBeInTheDocument()
    auth.userId = 'user-b'
    auth.sessionId = 'session-b'
    view.rerender(<SessionProvider><CacheProbe /></SessionProvider>)
    expect(screen.getByText('Empty cache')).toBeInTheDocument()
    expect(clients[1]).not.toBe(clients[0])
    expect(clients[0]!.getQueryCache().getAll()).toHaveLength(0)
  })

  it('scopes queries by identity even inside a shared query client', async () => {
    const client = new QueryClient()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([{ date: 'Private date A' }])))
    const view = render(<QueryClientProvider client={client}><History /></QueryClientProvider>)
    expect(await screen.findByText('Private date A')).toBeInTheDocument()
    auth.userId = 'user-b'
    auth.sessionId = 'session-b'
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    view.rerender(<QueryClientProvider client={client}><History /></QueryClientProvider>)
    expect(screen.queryByText('Private date A')).not.toBeInTheDocument()
    expect(screen.getByText('No private data')).toBeInTheDocument()
    client.clear()
  })
})


it('isolates summary data when the account changes inside a shared query client', async () => {
  const client = new QueryClient()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ measurement_count: 7 })))
  const { result, rerender } = renderHook(() => useWeightSummary('2026-09-01', '2026-09-20'), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
  await waitFor(() => expect(result.current.data?.measurement_count).toBe(7))
  auth.userId = 'user-b'
  auth.sessionId = 'session-b'
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  rerender()
  expect(result.current.data).toBeUndefined()
  expect(result.current.isPending).toBe(true)
  client.clear()
})


it('isolates rolling averages by account and invalidates them after each mutation', async () => {
  const client = new QueryClient()
  const fetchMock = vi.fn().mockImplementation(async () => Response.json({ window_days: 7, points: [{ date: '2026-09-20', mean_weight_kg: 82, measurement_count: 3 }] }))
  vi.stubGlobal('fetch', fetchMock)
  const { result, rerender } = renderHook(() => ({ average: useWeightRollingAverage(), save: useSaveWeightLog(), remove: useDeleteWeightLog() }), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
  await waitFor(() => expect(result.current.average.isSuccess).toBe(true))
  const averageCalls = () => fetchMock.mock.calls.filter(([url]) => url.includes('/rolling-average')).length
  const input = { date: '2026-09-20', weight_kg: 82 }
  await act(async () => { await result.current.save.mutateAsync({ input }) })
  expect(averageCalls()).toBe(2)
  await act(async () => { await result.current.save.mutateAsync({ id: 'one', input }) })
  expect(averageCalls()).toBe(3)
  await act(async () => { await result.current.remove.mutateAsync('one') })
  expect(averageCalls()).toBe(4)
  auth.userId = 'user-b'
  auth.sessionId = 'session-b'
  fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
  rerender()
  expect(result.current.average.data).toBeUndefined()
  expect(result.current.average.isPending).toBe(true)
  client.clear()
})
