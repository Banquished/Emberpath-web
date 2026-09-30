import { useAuth } from '@clerk/react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ActiveAllocationPreviewRequest, ActivePlanResponse, AllocationPreviewRequest, AllocationPreviewResponse, PlanHistoryResponse, SavePlanRequest } from '@/entities/nutrition-plan'
import type { PreviewResponse } from '@/entities/nutrition-preview'
import { isActivePlan, isAllocationPreview, isEndedActivePlan, isPlanHistory, isSavedActivePlan } from './plan-contract'
import { requestNutritionJson, type GetNutritionToken } from './nutrition-request'

const historyPageSize = 10
const planKeys = {
  active: (userId: string | null | undefined, sessionId: string | null | undefined) => ['nutrition', 'plans', 'active', userId, sessionId] as const,
  history: (userId: string | null | undefined, sessionId: string | null | undefined) => ['nutrition', 'plans', 'history', userId, sessionId] as const,
}

export type PlanAllocationSource =
  | { kind: 'new'; acceptedPreview: PreviewResponse }
  | { kind: 'active'; planId: string; expectedRevision: number }

export function previewPlanAllocation(getToken: GetNutritionToken, input: AllocationPreviewRequest, signal?: AbortSignal): Promise<AllocationPreviewResponse> {
  return requestNutritionJson(getToken, '/plans/allocations/preview', isAllocationPreview, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
}

export function previewActivePlanAllocation(getToken: GetNutritionToken, planId: string, input: ActiveAllocationPreviewRequest, signal?: AbortSignal): Promise<AllocationPreviewResponse> {
  return requestNutritionJson(getToken, `/plans/${encodeURIComponent(planId)}/allocations/preview`, isAllocationPreview, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
}

export function getActivePlan(getToken: GetNutritionToken, signal?: AbortSignal): Promise<ActivePlanResponse> {
  return requestNutritionJson(getToken, '/plans/active', isActivePlan, { signal })
}

export function getPlanHistory(getToken: GetNutritionToken, beforeVersion: number | null = null, signal?: AbortSignal): Promise<PlanHistoryResponse> {
  const params = new URLSearchParams({ limit: String(historyPageSize) })
  if (beforeVersion !== null) params.set('before_version', String(beforeVersion))
  return requestNutritionJson(getToken, `/plans?${params}`, isPlanHistory, { signal })
}

export function saveNutritionPlan(getToken: GetNutritionToken, input: SavePlanRequest): Promise<ActivePlanResponse> {
  return requestNutritionJson(getToken, '/plans', isSavedActivePlan, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }, 201)
}

export function replaceNutritionPlan(getToken: GetNutritionToken, input: SavePlanRequest): Promise<ActivePlanResponse> {
  return requestNutritionJson(getToken, '/plans/active/replacements', isSavedActivePlan, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function endNutritionPlan(getToken: GetNutritionToken, expectedRevision: number): Promise<ActivePlanResponse> {
  return requestNutritionJson(getToken, '/plans/active/end', isEndedActivePlan, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_revision: expectedRevision }),
  })
}

export function useActiveNutritionPlan() {
  const { getToken, userId, sessionId, isLoaded, isSignedIn } = useAuth()
  return useQuery({
    queryKey: planKeys.active(userId, sessionId),
    queryFn: ({ signal }) => getActivePlan(getToken, signal),
    enabled: isLoaded && isSignedIn,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function useNutritionPlanHistory() {
  const { getToken, userId, sessionId, isLoaded, isSignedIn } = useAuth()
  return useInfiniteQuery({
    queryKey: planKeys.history(userId, sessionId),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => getPlanHistory(getToken, pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.next_before_version ?? undefined,
    enabled: isLoaded && isSignedIn,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function usePlanAllocationPreview(source: PlanAllocationSource | null, weekdayKcal: number[] | null, editRevision: number) {
  const { getToken, userId, sessionId, isLoaded, isSignedIn } = useAuth()
  return useQuery({
    queryKey: ['nutrition', 'plans', 'allocation', userId, sessionId, source, weekdayKcal, editRevision],
    queryFn: ({ signal }) => {
      if (!source || !weekdayKcal) throw new Error('Enter a balanced allocation and verify the active plan before requesting a review.')
      return source.kind === 'active'
        ? previewActivePlanAllocation(getToken, source.planId, { expected_revision: source.expectedRevision, weekday_kcal: weekdayKcal }, signal)
        : previewPlanAllocation(getToken, { accepted_preview: source.acceptedPreview, weekday_kcal: weekdayKcal }, signal)
    },
    enabled: isLoaded && isSignedIn && source !== null && weekdayKcal !== null,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

function invalidatePlans(client: QueryClient, userId: string | null | undefined, sessionId: string | null | undefined) {
  return Promise.all([
    client.invalidateQueries({ queryKey: planKeys.active(userId, sessionId) }),
    client.invalidateQueries({ queryKey: planKeys.history(userId, sessionId) }),
  ])
}

export function useSaveNutritionPlan() {
  const { getToken, userId, sessionId } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['nutrition', 'plans', 'save', userId, sessionId],
    mutationFn: (input: SavePlanRequest) => saveNutritionPlan(getToken, input),
    onSuccess: () => invalidatePlans(client, userId, sessionId),
    retry: false,
  })
}

export function useReplaceNutritionPlan() {
  const { getToken, userId, sessionId } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['nutrition', 'plans', 'replace', userId, sessionId],
    mutationFn: (input: SavePlanRequest) => replaceNutritionPlan(getToken, input),
    onSuccess: () => invalidatePlans(client, userId, sessionId),
    retry: false,
  })
}

export function useEndNutritionPlan() {
  const { getToken, userId, sessionId } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['nutrition', 'plans', 'end', userId, sessionId],
    mutationFn: (revision: number) => endNutritionPlan(getToken, revision),
    onSuccess: () => invalidatePlans(client, userId, sessionId),
    retry: false,
  })
}
