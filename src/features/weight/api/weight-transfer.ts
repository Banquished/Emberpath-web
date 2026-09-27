import { useAuth } from '@clerk/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { env } from '@/app/config/env'
import type { ImportInput, ImportPreview, ImportResult, TransferDelimiter } from '@/entities/weight-transfer'
import { readWeightJson, requestWeight } from './weight-request'

const baseUrl = `${env.apiBaseUrl.replace(/\/$/, '')}/weight-logs`
const serviceError = 'The weight service could not complete the transfer. Please try again.'
const networkError = 'Cannot reach the weight service. Please try again.'
type TransferOperation = 'preview' | 'save' | 'download'

export function useWeightTransfer() {
  const { getToken, userId, sessionId } = useAuth()
  const client = useQueryClient()
  async function request(operation: TransferOperation, path: string, input?: ImportInput & { preview_token?: string }) {
    const response = await requestWeight(getToken, `${baseUrl}/${path}`, {
      method: input ? 'POST' : 'GET',
      ...(input ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}),
    }, networkError)
    if (!response.ok) {
      if (operation === 'save' && response.status === 409) throw new Error('Your measurements changed. Preview the file again before importing.')
      if (operation !== 'download' && response.status === 413) throw new Error('Choose a file no larger than 1 MiB.')
      if (operation !== 'download' && response.status === 422) throw new Error('Check the file: use date,weight,unit headers, ISO dates, and kg or lb units. Maximum 10,000 rows. Preview again after correcting errors.')
      throw new Error(serviceError)
    }
    return response
  }
  const preview = useMutation({ mutationFn: async (input: ImportInput) => readWeightJson<ImportPreview>(await request('preview', 'import/preview', input), serviceError) })
  const save = useMutation({
    mutationKey: ['weight-logs', userId, sessionId],
    mutationFn: async (input: ImportInput & { preview_token: string }) => readWeightJson<ImportResult>(await request('save', 'import', input), serviceError),
    onSuccess: () => client.invalidateQueries({ queryKey: ['weight-logs', userId, sessionId] }),
  })
  const download = useMutation({ mutationFn: async (delimiter: TransferDelimiter) => {
    const response = await request('download', `export?delimiter=${delimiter}`)
    if (response.status === 204) throw new Error(serviceError)
    const blob = await response.blob()
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
