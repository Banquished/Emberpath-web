import { useAuth } from '@clerk/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { env } from '@/app/config/env'
import type { WeightGoal, WeightGoalInput } from '@/entities/weight-goal'

const baseUrl = `${env.apiBaseUrl.replace(/\/$/, '')}/weight-goals`

async function request<T>(getToken: () => Promise<string | null>, path: string, options?: RequestInit): Promise<T> {
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
    if (response.status === 404 || response.status === 409) throw new Error('This goal has changed. Refresh the page and try again.')
    if (response.status === 422) throw new Error('Check your goal: weights must be positive and below 10,000 kg with at most two decimals. A target date must be after the start date. Enter a starting weight if you have no measurement on or before the start date.')
    throw new Error('The weight service could not update your goal. Please try again.')
  }
  return response.json() as Promise<T>
}

export function useActiveWeightGoal() {
  const { getToken, userId, sessionId, isLoaded, isSignedIn } = useAuth()
  return useQuery({
    queryKey: ['weight-goals', userId, sessionId],
    queryFn: ({ signal }) => request<WeightGoal | null>(getToken, '/active', { signal }),
    enabled: isLoaded && isSignedIn,
    retry: false,
  })
}

export function useSaveWeightGoal() {
  const { getToken, userId, sessionId } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['weight-goals', userId, sessionId],
    mutationFn: (input: WeightGoalInput) => request<WeightGoal>(getToken, '/active', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['weight-goals', userId, sessionId] }),
  })
}

export function useEndWeightGoal() {
  const { getToken, userId, sessionId } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['weight-goals', userId, sessionId],
    mutationFn: ({ id, status }: { id: string; status: 'completed' | 'cancelled' }) => request<WeightGoal>(getToken, `/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['weight-goals', userId, sessionId] }),
  })
}
