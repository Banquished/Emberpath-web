import { NutritionRequestError } from '../api/nutrition-request'

export function RequestFailure({ error, onRetry, retrying = false, heading }: {
  error: Error
  onRetry?: () => void
  retrying?: boolean
  heading?: string
}) {
  const denied = error instanceof NutritionRequestError && error.kind === 'forbidden'
  const expired = error instanceof NutritionRequestError && error.kind === 'authentication'
  const invalid = error instanceof NutritionRequestError && error.kind === 'invalid'
  const message = error instanceof NutritionRequestError ? error.message : 'The nutrition response could not be processed. Try again.'
  const title = denied ? 'Nutrition access denied' : expired ? 'Session verification failed' : invalid ? heading ? `${heading}: check your inputs` : 'Check your inputs' : heading ?? 'Nutrition preview unavailable'
  return (
    <div className="mt-6 rounded-xl border border-error bg-error-surface p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p role="alert" className="mt-2 text-sm text-error">{message}</p>
      {error instanceof NutritionRequestError && error.requestId && <p className="mt-2 break-all text-sm text-text-secondary">Request ID: {error.requestId}</p>}
      {onRetry && !denied && <button className="secondary-button mt-4" type="button" onClick={onRetry} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry'}</button>}
    </div>
  )
}
