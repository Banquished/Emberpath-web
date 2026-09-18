import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { env } from '@/app/config/env'
import type { WeightLog, WeightLogInput } from '@/entities/weight-log'

const baseUrl = `${env.apiBaseUrl.replace(/\/$/, '')}/weight-logs`

async function request<T>(path = '', options?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, options)
  } catch {
    throw new Error('Cannot reach the weight service. Check your connection and try again.')
  }
  if (!response.ok) {
    if (response.status === 409) throw new Error('A measurement already exists for this date. Edit that entry or choose another date.')
    if (response.status === 404) throw new Error('This measurement no longer exists. Refresh the history and try again.')
    if (response.status === 422) throw new Error('Check the date and weight. Weight must be positive, below 10,000 kg, with at most two decimal places.')
    throw new Error('The weight service could not complete the request. Please try again.')
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export const weightLogsQuery = queryOptions({
  queryKey: ['weight-logs'],
  queryFn: () => request<WeightLog[]>(),
  retry: 1,
})

export function useSaveWeightLog() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['weight-logs'],
    mutationFn: ({ id, input }: { id?: string; input: WeightLogInput }) =>
      request<WeightLog>(id ? `/${id}` : '', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: weightLogsQuery.queryKey }),
  })
}

export function useDeleteWeightLog() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['weight-logs'],
    mutationFn: (id: string) => request<void>(`/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: weightLogsQuery.queryKey }),
  })
}
