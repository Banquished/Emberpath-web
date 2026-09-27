import { useAuth } from '@clerk/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { env } from '@/app/config/env'
import type { WeightGoal, WeightGoalInput } from '@/entities/weight-goal'
import { readWeightJson, requestWeight, type GetWeightToken } from './weight-request'

const baseUrl = `${env.apiBaseUrl.replace(/\/$/, '')}/weight-goals`
const serviceError = 'The weight service could not update your goal. Please try again.'

async function request<T>(getToken: GetWeightToken, path: string, options?: RequestInit): Promise<T> {
  const response = await requestWeight(getToken, `${baseUrl}${path}`, options)
  if (!response.ok) {
    if ((options?.method === 'PATCH' && (response.status === 404 || response.status === 409)) ||
      (options?.method === 'PUT' && response.status === 409)) throw new Error('This goal has changed. Refresh the page and try again.')
    if (options?.method === 'PUT' && response.status === 422) throw new Error('Check your goal: weights must be positive and below 10,000 kg with at most two decimals. A target date must be after the start date. Enter a starting weight if you have no measurement on or before the start date.')
    throw new Error(serviceError)
  }
  return readWeightJson<T>(response, serviceError)
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
