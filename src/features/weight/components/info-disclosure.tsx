import { useId, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import './info-disclosure.css'

// Renders a toggle button and its panel as siblings so the parent layout decides where the panel opens.
export function InfoDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return <>
    <button type="button" className="info-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
      <Info aria-hidden="true" size={16} />{label}
    </button>
    <div id={panelId} className="info-panel" hidden={!open}>{children}</div>
  </>
}
