import { useAuth } from '@clerk/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { env } from '@/app/config/env'
import type { ImportInput, ImportPreview, ImportResult, TransferDelimiter } from '@/entities/weight-transfer'

export function useWeightTransfer() {
  const { getToken, userId, sessionId } = useAuth()
  const client = useQueryClient()
  async function request(path: string, input?: ImportInput & { preview_token?: string }) {
    const token = await getToken()
    if (!token) throw new Error('Your session has expired. Sign in again to continue.')
    let response: Response
    try {
      response = await fetch(`${env.apiBaseUrl.replace(/\/$/, '')}/weight-logs/${path}`, {
        method: input ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}),
      })
    } catch { throw new Error('Cannot reach the weight service. Please try again.') }
    if (!response.ok) {
      if (response.status === 401) throw new Error('Your session has expired. Sign in again to continue.')
      if (response.status === 409) throw new Error('Your measurements changed. Preview the file again before importing.')
      if (response.status === 413) throw new Error('Choose a file no larger than 1 MiB.')
      if (response.status === 422) throw new Error('Check the file: use date,weight,unit headers, ISO dates, and kg or lb units. Maximum 10,000 rows. Preview again after correcting errors.')
      throw new Error('The weight service could not complete the transfer. Please try again.')
    }
    return response
  }
  const preview = useMutation({ mutationFn: async (input: ImportInput) => (await request('import/preview', input)).json() as Promise<ImportPreview> })
  const save = useMutation({
    mutationKey: ['weight-logs', userId, sessionId],
    mutationFn: async (input: ImportInput & { preview_token: string }) => (await request('import', input)).json() as Promise<ImportResult>,
    onSuccess: () => client.invalidateQueries({ queryKey: ['weight-logs', userId, sessionId] }),
  })
  const download = useMutation({ mutationFn: async (delimiter: TransferDelimiter) => {
    const blob = await (await request(`export?delimiter=${delimiter}`)).blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `emberpath-weight-history.csv`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } })
  return { preview, save, download }
}
