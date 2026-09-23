import { useAuth } from '@clerk/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { env } from '@/app/config/env'
import type { RollingAverageWindow, WeightRollingAverage } from '@/entities/weight-rolling-average'
import type { WeightSummary } from '@/entities/weight-summary'
import type { WeightLog, WeightLogInput } from '@/entities/weight-log'

const baseUrl = `${env.apiBaseUrl.replace(/\/$/, '')}/weight-logs`
type GetToken = () => Promise<string | null>

async function request<T>(getToken: GetToken, path = '', options?: RequestInit): Promise<T> {
  const token = await getToken()
  if (!token) throw new Error('Your session has expired. Sign in again to continue.')
  const headers = new Headers(options?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  } catch {
    throw new Error('Cannot reach the weight service. Check your connection and try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Sign in again to continue.')
    if (response.status === 403) throw new Error('You do not have access to this measurement.')
    if (response.status === 409) throw new Error('A measurement already exists for this date. Edit that entry or choose another date.')
    if (response.status === 404) throw new Error('This measurement no longer exists. Refresh the history and try again.')
    if (response.status === 422) throw new Error('Check the date and weight. Weight must be positive, below 10,000 kg, with at most two decimal places.')
    throw new Error('The weight service could not complete the request. Please try again.')
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export function useWeightLogs() {
  const { getToken, userId, sessionId, isLoaded, isSignedIn } = useAuth()
  return useQuery({
    queryKey: ['weight-logs', userId, sessionId],
    queryFn: ({ signal }) => request<WeightLog[]>(getToken, '', { signal }),
    enabled: isLoaded && isSignedIn,
    retry: false,
  })
}

export function useWeightSummary(start?: string, end?: string) {
  const { getToken, userId, sessionId, isLoaded, isSignedIn } = useAuth()
  const params = new URLSearchParams()
  if (start) params.set('start_date', start)
  if (end) params.set('end_date', end)
  const query = params.toString()
  return useQuery({
    queryKey: ['weight-logs', userId, sessionId, 'summary', start, end],
    queryFn: ({ signal }) => request<WeightSummary>(getToken, `/summary${query ? `?${query}` : ''}`, { signal }),
    enabled: isLoaded && isSignedIn,
    retry: false,
  })
}

export function useWeightRollingAverage(start?: string, end?: string, windowDays: RollingAverageWindow = 7) {
  const { getToken, userId, sessionId, isLoaded, isSignedIn } = useAuth()
  const params = new URLSearchParams()
  if (start) params.set('start_date', start)
  if (end) params.set('end_date', end)
  params.set('window_days', String(windowDays))
  const query = params.toString()
  return useQuery({
    queryKey: ['weight-logs', userId, sessionId, 'rolling-average', start, end, windowDays],
    queryFn: ({ signal }) => request<WeightRollingAverage>(getToken, `/rolling-average${query ? `?${query}` : ''}`, { signal }),
    enabled: isLoaded && isSignedIn,
    retry: false,
  })
}

export function useSaveWeightLog() {
  const { getToken, userId, sessionId } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['weight-logs', userId, sessionId],
    mutationFn: ({ id, input }: { id?: string; input: WeightLogInput }) =>
      request<WeightLog>(getToken, id ? `/${id}` : '', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['weight-logs', userId, sessionId] }),
  })
}

export function useDeleteWeightLog() {
  const { getToken, userId, sessionId } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['weight-logs', userId, sessionId],
    mutationFn: (id: string) => request<void>(getToken, `/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['weight-logs', userId, sessionId] }),
  })
}
