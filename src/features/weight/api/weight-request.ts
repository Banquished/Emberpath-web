export type GetWeightToken = () => Promise<string | null>

const sessionError = 'Your session has expired. Sign in again to continue.'
const networkError = 'Cannot reach the weight service. Check your connection and try again.'

export async function requestWeight(
  getToken: GetWeightToken,
  url: string,
  options?: RequestInit,
  networkMessage = networkError,
): Promise<Response> {
  const token = await getToken()
  if (!token) throw new Error(sessionError)

  const headers = new Headers(options?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try {
    response = await fetch(url, { ...options, headers })
  } catch (error) {
    if (options?.signal?.aborted || ((error instanceof Error || error instanceof DOMException) && error.name === 'AbortError')) throw error
    throw new Error(networkMessage, { cause: error })
  }
  if (response.status === 401) throw new Error(sessionError)
  return response
}

export function readWeightJson<T>(response: Response, emptyResponseMessage: string): Promise<T> {
  if (response.status === 204) throw new Error(emptyResponseMessage)
  return response.json() as Promise<T>
}
