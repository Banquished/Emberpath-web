import { useAuth } from '@clerk/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { PreviewOptions, PreviewRequest, PreviewResponse } from '@/entities/nutrition-preview'
import { isPreviewOptions, isPreviewResponse } from './preview-contract'
import { requestNutritionJson, type GetNutritionToken } from './nutrition-request'

export { NutritionRequestError } from './nutrition-request'

export function getNutritionOptions(getToken: GetNutritionToken, signal?: AbortSignal): Promise<PreviewOptions> {
  return requestNutritionJson(getToken, '/estimates/options', isPreviewOptions, { signal })
}

export function previewNutrition(getToken: GetNutritionToken, input: PreviewRequest): Promise<PreviewResponse> {
  return requestNutritionJson(getToken, '/estimates/preview', (value): value is PreviewResponse => isPreviewResponse(value, input.method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function useNutritionOptions() {
  const { getToken, userId, sessionId, isLoaded, isSignedIn } = useAuth()
  return useQuery({
    queryKey: ['nutrition', 'options', userId, sessionId],
    queryFn: ({ signal }) => getNutritionOptions(getToken, signal),
    enabled: isLoaded && isSignedIn,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function useNutritionPreview() {
  const { getToken, userId, sessionId } = useAuth()
  return useMutation({
    mutationKey: ['nutrition', 'preview', userId, sessionId],
    mutationFn: (input: PreviewRequest) => previewNutrition(getToken, input),
    retry: false,
  })
}
