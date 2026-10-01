import { Activity, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { periods, type Period } from '../weight-range'
import './weight-workspace.css'

const views = [{ id: 'chart', label: 'Chart' }, { id: 'history', label: 'History' }] as const
type View = typeof views[number]['id']

function targetIndex(key: string, current: number, count: number) {
  switch (key) {
    case 'ArrowRight': return (current + 1) % count
    case 'ArrowLeft': return (current + count - 1) % count
    case 'Home': return 0
    case 'End': return count - 1
    default: return undefined
  }
}

interface WeightWorkspaceProps {
  period: Period
  onPeriodChange: (period: Period) => void
  measurementCount?: number
  busy: boolean
  onLog: () => void
  notice?: ReactNode
  chart: ReactNode
  history: ReactNode
}

export function WeightWorkspace({ period, onPeriodChange, measurementCount, busy, onLog, notice, chart, history }: WeightWorkspaceProps) {
  const baseId = useId()
  const [view, setView] = useState<View>('chart')
  const tabId = (id: View) => `${baseId}-${id}-tab`
  const panelId = (id: View) => `${baseId}-${id}-panel`

  function changePeriod(value: string) {
    const next = periods.find((option) => option.value === value)
    if (next) onPeriodChange(next.value)
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const target = targetIndex(event.key, views.findIndex((option) => option.id === view), views.length)
    const next = target === undefined ? undefined : views[target]
    if (!next) return
    event.preventDefault()
    setView(next.id)
    event.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')[views.indexOf(next)]?.focus()
  }

  return <section className="weight-workspace" aria-label="Weight data">
    <div className="workspace-header">
      <div className="workspace-tabs" role="tablist" aria-label="Weight data view" onKeyDown={navigate}>
        {views.map((option) => <button key={option.id} id={tabId(option.id)} className="workspace-tab" type="button" role="tab" aria-selected={view === option.id} aria-controls={panelId(option.id)} tabIndex={view === option.id ? 0 : -1} onClick={() => setView(option.id)}>{option.label}</button>)}
      </div>
      <button className="log-button" type="button" disabled={busy} onClick={onLog}>Log weight</button>
    </div>
    <div className="period-toolbar">
      <div className="period-buttons" role="group" aria-label="Measurement period">
        {periods.map((option) => <button key={option.value} type="button" aria-label={option.label} aria-pressed={period === option.value} onClick={() => onPeriodChange(option.value)}>{option.short}</button>)}
      </div>
      <label className="period-select">Period<select value={period} onChange={(event) => changePeriod(event.target.value)}>{periods.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <span className="unit-label">{periods.find((option) => option.value === period)?.label}{measurementCount !== undefined && ` · ${measurementCount} measurements`}</span>
    </div>
    {notice}
    {views.map((option) => <div key={option.id} id={panelId(option.id)} className="workspace-panel" role="tabpanel" aria-labelledby={tabId(option.id)} hidden={view !== option.id}>
      {/* Activity keeps a hidden view's state but pauses its effects, so a hidden chart never measures itself at 0x0. */}
      <Activity mode={view === option.id ? 'visible' : 'hidden'}>{option.id === 'chart' ? chart : history}</Activity>
    </div>)}
  </section>
}
