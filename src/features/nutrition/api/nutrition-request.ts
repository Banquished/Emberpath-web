import { env } from '@/app/config/env'

export type GetNutritionToken = () => Promise<string | null>
export type NutritionErrorKind = 'authentication' | 'forbidden' | 'invalid' | 'conflict' | 'not-found' | 'storage' | 'unavailable' | 'network' | 'service'

export class NutritionRequestError extends Error {
  readonly kind: NutritionErrorKind
  readonly requestId?: string

  constructor(kind: NutritionErrorKind, message: string, requestId?: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NutritionRequestError'
    this.kind = kind
    this.requestId = requestId
  }
}

const baseUrl = `${env.apiBaseUrl.replace(/\/$/, '')}/nutrition/v1`

function isAbort(error: unknown, signal?: AbortSignal | null) {
  return signal?.aborted || ((error instanceof Error || error instanceof DOMException) && error.name === 'AbortError')
}

async function authenticatedFetch(getToken: GetNutritionToken, url: string, options?: RequestInit): Promise<Response> {
  let token: string | null
  try {
    token = await getToken()
  } catch (error) {
    if (isAbort(error, options?.signal)) throw error
    throw new NutritionRequestError('authentication', 'Could not verify your nutrition session. Sign out and sign in again.', undefined, { cause: error })
  }
  if (!token) throw new NutritionRequestError('authentication', 'Your nutrition session has expired. Sign out and sign in again.')

  const headers = new Headers(options?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  try {
    return await fetch(url, { ...options, headers })
  } catch (error) {
    if (isAbort(error, options?.signal)) throw error
    throw new NutritionRequestError('network', 'Cannot reach the nutrition service. Check your connection and try again.', undefined, { cause: error })
  }
}

type ErrorBody = { detail: string; request_id: string }

function isErrorBody(value: unknown): value is ErrorBody {
  return typeof value === 'object' && value !== null &&
    'detail' in value && typeof value.detail === 'string' &&
    'request_id' in value && typeof value.request_id === 'string'
}

async function readError(response: Response): Promise<ErrorBody> {
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    if (isAbort(error)) throw error
    throw new NutritionRequestError('service', 'The nutrition service returned an unreadable error response.', response.headers.get('X-Request-ID') ?? undefined, { cause: error })
  }
  if (!isErrorBody(body)) throw new NutritionRequestError('service', 'The nutrition service returned an invalid error response.', response.headers.get('X-Request-ID') ?? undefined)
  return body
}

function failure(response: Response, body: ErrorBody): NutritionRequestError {
  const requestId = response.headers.get('X-Request-ID') ?? body.request_id
  switch (response.status) {
    case 401:
      return new NutritionRequestError('authentication', 'Your nutrition session could not be verified. Sign out and sign in again.', requestId)
    case 403:
      return new NutritionRequestError('forbidden', 'The nutrition service denied this request for your account.', requestId)
    case 404:
      return body.detail === 'Plan not found'
        ? new NutritionRequestError('not-found', 'This saved plan could not be found.', requestId)
        : new NutritionRequestError('service', 'The nutrition service could not complete the request. Try again.', requestId)
    case 409:
      return new NutritionRequestError('conflict', body.detail, requestId)
    case 422:
      return new NutritionRequestError('invalid', body.detail === 'Invalid request' ? 'Invalid request. Check your inputs and try again.' : body.detail, requestId)
    case 503:
      if (body.detail === 'Plan storage is not configured') {
        return new NutritionRequestError('storage', 'Saved plans are unavailable because nutrition storage is not configured.', requestId)
      }
      if (body.detail === 'Plan clock is inconsistent') {
        return new NutritionRequestError('unavailable', 'Plan changes are temporarily unavailable. No plan was changed.', requestId)
      }
      return new NutritionRequestError('unavailable', 'The nutrition service is temporarily unavailable. Try again later.', requestId)
    default:
      return new NutritionRequestError('service', 'The nutrition service could not complete the request. Try again.', requestId)
  }
}

export async function requestNutritionJson<T>(
  getToken: GetNutritionToken,
  path: string,
  isValid: (value: unknown) => value is T,
  options?: RequestInit,
  expectedStatus: 200 | 201 = 200,
): Promise<T> {
  const response = await authenticatedFetch(getToken, `${baseUrl}${path}`, options)
  if (!response.ok) throw failure(response, await readError(response))
  const requestId = response.headers.get('X-Request-ID') ?? undefined
  if (response.status === 204) throw new NutritionRequestError('service', 'The nutrition service returned an empty response.', requestId)
  if (response.status !== expectedStatus) throw new NutritionRequestError('service', 'The nutrition service returned an unexpected success status.', requestId)
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    if (isAbort(error, options?.signal)) throw error
    throw new NutritionRequestError('service', 'The nutrition service returned an unreadable response.', requestId, { cause: error })
  }
  if (!isValid(body)) throw new NutritionRequestError('service', 'The nutrition service returned an invalid response.', requestId)
  return body
}
