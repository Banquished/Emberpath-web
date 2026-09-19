import { useEffect, useRef } from 'react'
import type { WeightLog } from '@/entities/weight-log'
import { WeightLogForm } from './weight-log-form'

export function WeightLogDialog({ entry, busy, onClose, onSaved }: {
  entry: WeightLog | null
  busy: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement as HTMLElement | null
    element.showModal()
    element.querySelector<HTMLInputElement>('#weight-value')?.focus()
    return () => {
      element.close()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])

  return <dialog ref={dialog} className="weight-dialog" aria-labelledby="entry-title" onCancel={(event) => {
    event.preventDefault()
    if (!busy) onClose()
  }}>
    <WeightLogForm entry={entry} disabled={busy} onCancel={onClose} onSaved={onSaved} />
  </dialog>
}
