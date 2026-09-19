import { useId, useState } from 'react'
import type { WeightLog } from '@/entities/weight-log'
import './weight-history.css'

interface WeightHistoryProps {
  entries: WeightLog[]
  busy: boolean
  onEdit: (entry: WeightLog) => void
  onDelete: (entry: WeightLog) => void
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const weightFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })

export function WeightHistory({ entries, busy, onEdit, onDelete }: WeightHistoryProps) {
  const headingId = useId()
  const [pageSize, setPageSize] = useState(10)
  const [requestedPage, setRequestedPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize))
  const page = Math.min(requestedPage, pageCount)
  const start = (page - 1) * pageSize
  const visibleEntries = entries.slice(start, start + pageSize)

  if (requestedPage !== page) setRequestedPage(page)

  return (
    <section className="weight-history paginated-history" aria-labelledby={headingId}>
      <header className="history-heading">
        <div>
          <h2 id={headingId}>Weight history</h2>
          <p className="history-order">Most recent first</p>
        </div>
        <label className="history-page-size">
          Rows
          <select value={pageSize} onChange={(event) => {
            setPageSize(Number(event.target.value))
            setRequestedPage(1)
          }}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>
      </header>

      <div key={`${page}-${pageSize}`} className="history-scroll" role="region" aria-label="Weight measurements" tabIndex={0}>
        {entries.length === 0 ? (
          <div className="history-period-empty">
            <h3>No measurements in this period</h3>
            <p>Choose a longer period or log your weight to get started.</p>
          </div>
        ) : (
          <table className="history-table">
            <caption className="history-screen-reader">Recorded weights in kilograms, most recent first</caption>
            <thead>
              <tr><th scope="col">Date</th><th scope="col">Weight</th><th scope="col" className="history-actions-column">Actions</th></tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => {
                const date = dateFormatter.format(new Date(`${entry.date}T12:00:00`))
                return (
                  <tr key={entry.id}>
                    <th scope="row"><time dateTime={entry.date}>{date}</time></th>
                    <td className="history-weight">{weightFormatter.format(entry.weight_kg)} <span>kg</span></td>
                    <td className="history-actions-column">
                      <details className="history-actions">
                        <summary aria-label={`Actions for ${date}`}>Actions</summary>
                        <div className="history-action-buttons">
                          <button className="secondary-button" type="button" disabled={busy} aria-label={`Edit measurement for ${date}`} onClick={(event) => {
                            event.currentTarget.closest('details')?.querySelector('summary')?.focus()
                            event.currentTarget.closest('details')?.removeAttribute('open')
                            onEdit(entry)
                          }}>Edit</button>
                          <button className="secondary-button delete-button" type="button" disabled={busy} aria-label={`Delete measurement for ${date}`} onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open')
                            onDelete(entry)
                          }}>Delete</button>
                        </div>
                      </details>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <footer className="history-footer history-pagination">
        <p role="status">{entries.length ? `Showing ${start + 1}–${Math.min(start + pageSize, entries.length)} of ${entries.length}` : '0 measurements'}</p>
        <nav aria-label="Weight history pagination">
          <button className="secondary-button" type="button" disabled={page === 1} onClick={() => setRequestedPage(page - 1)}>Previous</button>
          <span aria-label={`Page ${page} of ${pageCount}`}>{page} / {pageCount}</span>
          <button className="secondary-button" type="button" disabled={page === pageCount} onClick={() => setRequestedPage(page + 1)}>Next</button>
        </nav>
      </footer>
    </section>
  )
}
