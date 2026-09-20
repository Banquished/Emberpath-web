import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WeightLog } from '@/entities/weight-log'
import { chartMeasurements } from '../weight-range'

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const fullDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function WeightChart({ entries }: { entries: WeightLog[] }) {
  const points = chartMeasurements(entries)
  return <section className="weight-chart-panel" aria-labelledby="chart-title">
    <header className="chart-heading"><h2 id="chart-title">Your progress</h2><span className="unit-label">Weight · kg</span></header>
    {entries.length ? <>
      <div className="weight-chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={points} margin={{ top: 16, right: 18, bottom: 8, left: 0 }} accessibilityLayer title="Daily weight measurements" aria-describedby="chart-help">
            <CartesianGrid vertical={false} stroke="var(--ep-semantic-border-subtle)" />
            <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => shortDate.format(value)} minTickGap={45} tick={{ fill: 'var(--ep-semantic-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis domain={[(min: number) => Math.max(0, Math.floor(min - 1)), (max: number) => Math.ceil(max + 1)]} width={48} tick={{ fill: 'var(--ep-semantic-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip labelFormatter={(value) => fullDate.format(Number(value))} formatter={(value) => [`${value} kg`, 'Weight']} contentStyle={{ background: 'var(--ep-semantic-surface)', border: '1px solid var(--ep-semantic-border-control)', borderRadius: 8, color: 'var(--ep-semantic-text-primary)' }} />
            <Line dataKey="weight" type="linear" connectNulls stroke="var(--ep-semantic-text-secondary)" strokeOpacity={0.65} strokeWidth={1.5} strokeDasharray="5 5" dot={false} activeDot={false} tooltipType="none" legendType="none" isAnimationActive={false} />
            <Line dataKey="weight" name="Weight" type="linear" connectNulls={false} stroke="var(--ep-semantic-chart-trend)" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: 'var(--ep-semantic-chart-trend)' }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p id="chart-help" className="chart-help">Daily measurements · Dashed lines connect measurements across unrecorded days. Tap a point or use arrow keys on the chart. Exact values are in the history below.</p>
    </> : <div className="chart-empty"><p>No measurements in this period.</p><p>Choose another period or log your weight to get started.</p></div>}
  </section>
}
