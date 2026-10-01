import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState, type ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WeightWorkspace } from './weight-workspace'

function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0)
  return <button type="button" onClick={() => setCount(count + 1)}>{label} {count}</button>
}

const panelFor = (tab: HTMLElement) => document.getElementById(tab.getAttribute('aria-controls')!)!

function setup(props: Partial<ComponentProps<typeof WeightWorkspace>> = {}) {
  const onPeriodChange = vi.fn()
  const onLog = vi.fn()
  render(<WeightWorkspace period="1m" onPeriodChange={onPeriodChange} measurementCount={25} busy={false} onLog={onLog} chart={<Counter label="Chart control" />} history={<Counter label="History control" />} {...props} />)
  return { user: userEvent.setup(), onPeriodChange, onLog }
}

describe('tabs', () => {
  it('presents Chart and History as a tablist with Chart selected first', () => {
    setup()
    const tablist = screen.getByRole('tablist', { name: 'Weight data view' })
    const chartTab = within(tablist).getByRole('tab', { name: 'Chart' })
    const historyTab = within(tablist).getByRole('tab', { name: 'History' })
    expect(chartTab).toHaveAccessibleName('Chart')
    expect(historyTab).toHaveAccessibleName('History')
    expect(chartTab).toHaveAttribute('aria-selected', 'true')
    expect(historyTab).toHaveAttribute('aria-selected', 'false')
    expect(chartTab).toHaveAttribute('tabindex', '0')
    expect(historyTab).toHaveAttribute('tabindex', '-1')
    const chartPanel = screen.getByRole('tabpanel', { name: 'Chart' })
    const historyPanel = panelFor(historyTab)
    expect(historyPanel).toHaveAttribute('role', 'tabpanel')
    expect(chartTab).toHaveAttribute('aria-controls', chartPanel.id)
    expect(historyTab).toHaveAttribute('aria-controls', historyPanel.id)
    expect(chartPanel).toHaveAttribute('aria-labelledby', chartTab.id)
    expect(historyPanel).toHaveAttribute('aria-labelledby', historyTab.id)
    expect(new Set([chartTab.id, historyTab.id, chartPanel.id, historyPanel.id]).size).toBe(4)
    expect(chartPanel).toBeVisible()
    expect(historyPanel).not.toBeVisible()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })

  it('shows exactly one view when a tab is selected', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Chart' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByRole('tabpanel', { name: 'History' })).toBeVisible()
    expect(panelFor(screen.getByRole('tab', { name: 'Chart' }))).not.toBeVisible()
  })

  it('moves selection and focus with the arrow keys, Home and End', async () => {
    const { user } = setup()
    const chartTab = screen.getByRole('tab', { name: 'Chart' })
    const historyTab = screen.getByRole('tab', { name: 'History' })
    await user.click(chartTab)
    const expectSelected = (selected: HTMLElement, other: HTMLElement) => {
      expect(selected).toHaveAttribute('aria-selected', 'true')
      expect(selected).toHaveAttribute('tabindex', '0')
      expect(selected).toHaveFocus()
      expect(other).toHaveAttribute('aria-selected', 'false')
      expect(other).toHaveAttribute('tabindex', '-1')
    }
    await user.keyboard('{ArrowRight}')
    expectSelected(historyTab, chartTab)
    await user.keyboard('{ArrowRight}')
    expectSelected(chartTab, historyTab)
    await user.keyboard('{ArrowLeft}')
    expectSelected(historyTab, chartTab)
    await user.keyboard('{Home}')
    expectSelected(chartTab, historyTab)
    await user.keyboard('{End}')
    expectSelected(historyTab, chartTab)
    await user.keyboard('{ArrowDown}{ArrowUp}a')
    expectSelected(historyTab, chartTab)
  })

  it('never exposes controls from the hidden view', async () => {
    const { user } = setup()
    expect(screen.getByRole('button', { name: 'Chart control 0' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'History control 0' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByRole('button', { name: 'History control 0' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Chart control 0' })).not.toBeInTheDocument()
  })

  it('keeps each view mounted with its own state while it is hidden', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Chart control 0' }))
    await user.click(screen.getByRole('tab', { name: 'History' }))
    await user.click(screen.getByRole('button', { name: 'History control 0' }))
    await user.click(screen.getByRole('button', { name: 'History control 1' }))
    await user.click(screen.getByRole('tab', { name: 'Chart' }))
    expect(screen.getByRole('button', { name: 'Chart control 1' })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByRole('button', { name: 'History control 2' })).toBeVisible()
  })

  it('pauses effects in a hidden view and resumes them when it is shown again', async () => {
    const log: string[] = []
    function Probe() {
      useEffect(() => { log.push('start'); return () => { log.push('stop') } }, [])
      return <p>Probe</p>
    }
    const { user } = setup({ chart: <Probe /> })
    expect(log).toEqual(['start'])
    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(log).toEqual(['start', 'stop'])
    await user.click(screen.getByRole('tab', { name: 'Chart' }))
    expect(log).toEqual(['start', 'stop', 'start'])
  })
})

describe('toolbar', () => {
  it('puts Log weight in the same header as the tabs, for both views', async () => {
    const { user, onLog } = setup()
    const tablist = screen.getByRole('tablist')
    const logButton = within(tablist.parentElement!).getByRole('button', { name: 'Log weight' })
    expect(logButton).toBeEnabled()
    await user.click(logButton)
    await user.click(screen.getByRole('tab', { name: 'History' }))
    await user.click(within(tablist.parentElement!).getByRole('button', { name: 'Log weight' }))
    expect(onLog).toHaveBeenCalledTimes(2)
  })

  it('disables Log weight while a measurement change is pending', () => {
    setup({ busy: true })
    expect(screen.getByRole('button', { name: 'Log weight' })).toBeDisabled()
  })

  it('shares one range selector across both views', async () => {
    const { user, onPeriodChange } = setup()
    const group = screen.getByRole('group', { name: 'Measurement period' })
    expect(within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Last week', 'Last 2 weeks', 'Last month', 'Last 3 months', 'Last 6 months', 'Last 12 months', 'All time'])
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['1W', '2W', '1M', '3M', '6M', '12M', 'All'])
    expect(within(group).getByRole('button', { name: 'Last month' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'Last week' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(group).getByRole('button', { name: 'Last 3 months' }))
    expect(onPeriodChange).toHaveBeenLastCalledWith('3m')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), '6m')
    expect(onPeriodChange).toHaveBeenLastCalledWith('6m')
    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByRole('group', { name: 'Measurement period' })).toBe(group)
    expect(screen.getAllByRole('group', { name: 'Measurement period' })).toHaveLength(1)
  })

  it('summarizes the selected range and only counts measurements once they are known', () => {
    setup()
    expect(screen.getByText('Last month · 25 measurements', { selector: 'span' })).toBeInTheDocument()
  })

  it('does not invent a measurement count while history is unavailable', () => {
    setup({ measurementCount: undefined, period: '3m' })
    expect(screen.getByText('Last 3 months', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText(/measurements/)).not.toBeInTheDocument()
  })

  it('renders notices between the toolbar and the views regardless of the selected view', async () => {
    const { user } = setup({ notice: <p role="status">Measurement saved.</p> })
    expect(screen.getByRole('status')).toHaveTextContent('Measurement saved.')
    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByRole('status')).toHaveTextContent('Measurement saved.')
  })
})
