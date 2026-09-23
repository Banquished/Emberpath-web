import { useEffect, useRef, useState } from 'react'
import type { DuplicatePolicy, ImportInput, TransferDelimiter } from '@/entities/weight-transfer'
import { useWeightTransfer } from '../api/weight-transfer'
import './weight-transfer.css'

export function WeightTransfer({ busy }: { busy: boolean }) {
  const [open, setOpen] = useState(false)
  const [exportDelimiter, setExportDelimiter] = useState<TransferDelimiter>('comma')
  const [message, setMessage] = useState('')
  const { download } = useWeightTransfer()
  return <div className="weight-transfer">
    <div className="transfer-controls" aria-label="Measurement files">
      <button className="secondary-button" disabled={busy} onClick={() => { setMessage(''); setOpen(true) }}>Import file</button>
      <label>Export delimiter<select value={exportDelimiter} onChange={(event) => setExportDelimiter(event.target.value as TransferDelimiter)}><option value="comma">Comma</option><option value="semicolon">Semicolon</option><option value="tab">Tab</option></select></label>
      <button className="secondary-button" disabled={download.isPending} onClick={() => download.mutate(exportDelimiter)}>{download.isPending ? 'Exporting...' : 'Export all history'}</button>
    </div>
    <p className="transfer-help">Exports include all your measurements in kilograms, regardless of the selected period.</p>
    {message && <p role="status">{message}</p>}
    {download.error && <p className="form-error" role="alert">{download.error.message}</p>}
    {open && <ImportDialog onClose={() => setOpen(false)} onSaved={(result) => { setMessage(result); setOpen(false) }} />}
  </div>
}

function ImportDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [input, setInput] = useState<ImportInput | null>(null)
  const [policy, setPolicy] = useState<DuplicatePolicy>('skip')
  const [delimiter, setDelimiter] = useState<TransferDelimiter>('comma')
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)
  const [page, setPage] = useState(0)
  const { preview, save } = useWeightTransfer()
  const pending = preview.isPending || save.isPending || reading
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    element.querySelector<HTMLInputElement>('input')?.focus()
    return () => { element.close(); if (trigger?.isConnected) trigger.focus() }
  }, [])
  async function chooseFile(file?: File) {
    setPage(0); preview.reset(); save.reset(); setInput(null); setFileError('')
    if (!file) return
    const extension = file.name.split('.').at(-1)?.toLowerCase()
    if (extension !== 'csv' && extension !== 'txt') { setFileError('Choose a .csv or .txt file.'); return }
    if (file.size > 1024 * 1024) { setFileError('Choose a file no larger than 1 MiB.'); return }
    setReading(true)
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      setInput({ content, delimiter, duplicate_policy: policy })
    } catch { setFileError('The file could not be read as UTF-8. Save it with UTF-8 encoding and try again.') }
    finally { setReading(false) }
  }
  function changeDelimiter(value: TransferDelimiter) {
    setPage(0); setDelimiter(value); preview.reset(); save.reset()
    setInput((current) => current ? { ...current, delimiter: value } : null)
  }
  function changePolicy(value: DuplicatePolicy) {
    setPage(0); setPolicy(value); preview.reset(); save.reset()
    setInput((current) => current ? { ...current, duplicate_policy: value } : null)
  }
  const result = preview.data
  return <dialog ref={dialog} className="weight-dialog transfer-dialog" aria-labelledby="import-title" onCancel={(event) => { event.preventDefault(); if (!pending) onClose() }}>
    <h2 id="import-title">Import measurements</h2>
    <p className="transfer-help">UTF-8 delimited text (.csv or .txt), up to 1 MiB and 10,000 rows. Headers: date,weight,unit using the selected delimiter. Use dates such as 2026-09-21, decimal points, and kg or lb. Pounds are converted to kilograms.</p>
    <label>Measurement file<input type="file" accept=".csv,.txt" disabled={pending} onChange={(event) => void chooseFile(event.target.files?.[0])} /></label>
    <label>Delimiter<select value={delimiter} disabled={pending} onChange={(event) => changeDelimiter(event.target.value as TransferDelimiter)}><option value="comma">Comma</option><option value="semicolon">Semicolon</option><option value="tab">Tab</option></select></label>
    <label>Existing dates<select value={policy} disabled={pending} onChange={(event) => changePolicy(event.target.value as DuplicatePolicy)}><option value="skip">Skip existing measurements</option><option value="replace">Replace existing measurements</option></select></label>
    {policy === 'replace' && <p className="transfer-help">Replacing overwrites the weight recorded on matching dates. Review the replacement count before confirming.</p>}
    <button className="secondary-button" disabled={!input || pending} onClick={() => { setPage(0); save.reset(); if (input) preview.mutate(input) }}>{preview.isPending ? 'Checking...' : 'Preview import'}</button>
    {fileError && <p className="form-error" role="alert">{fileError}</p>}
    {preview.error && <p className="form-error" role="alert">{preview.error.message}</p>}
    {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
    {result && <>
      <p role="status">{result.imported} new, {result.replaced} replacements, {result.skipped} skipped, {result.errors} errors.</p>
      <div className="import-preview" tabIndex={0} aria-label="Import preview"><table><thead><tr><th>Row</th><th>Date</th><th>Weight (kg)</th><th>Result</th></tr></thead><tbody>{result.rows.slice(page * 100, (page + 1) * 100).map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.date ?? '-'}</td><td>{row.weight_kg ?? '-'}</td><td>{row.errors.length ? row.errors.join(' ') : row.action}</td></tr>)}</tbody></table></div>
      {result.rows.length > 100 && <div className="transfer-controls"><button className="secondary-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous rows</button><span>Page {page + 1} of {Math.ceil(result.rows.length / 100)}</span><button className="secondary-button" disabled={(page + 1) * 100 >= result.rows.length} onClick={() => setPage(page + 1)}>Next rows</button></div>}
      {result.errors > 0 && <p className="form-error">Correct all errors and choose the file again. Nothing has been saved.</p>}
    </>}
    <div className="transfer-controls transfer-actions">
      <button className="secondary-button" disabled={pending} onClick={onClose}>Cancel</button>
      <button className="log-button" disabled={pending || !input || !result || result.errors > 0 || result.imported + result.replaced === 0 || save.isError} onClick={() => {
        if (input && result) save.mutate({ ...input, preview_token: result.preview_token }, { onSuccess: (saved) => onSaved(`Import complete: ${saved.imported} added, ${saved.replaced} replaced, ${saved.skipped} skipped.`) })
      }}>{save.isPending ? 'Importing...' : 'Confirm import'}</button>
    </div>
  </dialog>
}
