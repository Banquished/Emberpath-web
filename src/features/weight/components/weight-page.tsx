import { Plus } from 'lucide-react'

export function WeightPage() {
  return (
    <section aria-labelledby="weight-title">
      <title>Weight · Emberpath</title>
      <div className="page-heading">
        <div>
          <h1 id="weight-title">Weight</h1>
          <p className="page-description">A place to follow your progress, at your pace.</p>
        </div>
        <div className="logging-action">
          <button className="log-button" type="button" disabled aria-describedby="logging-status">
            <Plus size={18} aria-hidden="true" />
            Log weight
          </button>
          <p id="logging-status">Logging is coming next.</p>
        </div>
      </div>

      <section className="weight-history" aria-labelledby="history-title">
        <header className="history-heading">
          <h2 id="history-title">Weight history</h2>
          <span className="unit-label">Kilograms</span>
        </header>
        <div className="weight-empty">
          <div className="empty-symbol" aria-hidden="true">
            <img src="/brand/logos/emberpath-mark.svg" alt="" width="44" height="48" />
          </div>
          <h3>No measurements yet</h3>
          <p>Your entries and weight trend will appear here once you start logging.</p>
        </div>
        <div className="history-footer">
          <span className="history-legend" aria-hidden="true"></span>
          <span>A view of your progress over time.</span>
        </div>
      </section>
    </section>
  )
}
