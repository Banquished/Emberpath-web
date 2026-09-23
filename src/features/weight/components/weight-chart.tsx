import { useState } from 'react'
import { CartesianGrid, ReferenceLine, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WeightGoal } from '@/entities/weight-goal'
import type { RollingAverageWindow } from '@/entities/weight-rolling-average'
import type { WeightLog } from '@/entities/weight-log'
import { chartMeasurements, dateKey } from '../weight-range'
import { chartTimeAxis, visibleGoalSegment } from '../weight-chart-window'
import { useWeightRollingAverage } from '../api/weight-logs'

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const fullDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function WeightChart({ entries, start, end, goal }: { entries: WeightLog[]; start?: string; end?: string; goal?: WeightGoal | null }) {
  const [windowDays, setWindowDays] = useState<RollingAverageWindow>(7)
  const average = useWeightRollingAverage(start, end, windowDays)
  const means = new Map((average.isError ? [] : average.data?.points ?? []).map((point) => [point.date, point.mean_weight_kg]))
  const points = chartMeasurements(entries).map((point) => ({
    ...point,
    average: point.weight === null ? null : means.get(dateKey(new Date(point.timestamp))) ?? null,
  }))
  const [showGoal, setShowGoal] = useState(true)
  const plannedSegment = showGoal && goal ? visibleGoalSegment(goal, start, new Date()) : undefined
  const showFlatTarget = showGoal && goal && (!goal.target_date || !goal.plan)
  const hasGoalLine = plannedSegment || showFlatTarget
  const timestamps = [...points.map((point) => point.timestamp), ...(plannedSegment?.map((point) => point.x) ?? [])]
  const timeAxis = timestamps.length ? chartTimeAxis(timestamps) : undefined
  return <section className="weight-chart-panel" aria-labelledby="chart-title">
    <header className="chart-heading"><h2 id="chart-title">Your progress</h2><label className="chart-average-select">Rolling average<select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value) as RollingAverageWindow)}><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></label><span className="unit-label">Weight · kg</span>{goal && <label className="chart-goal-toggle"><input type="checkbox" checked={showGoal} onChange={(event) => setShowGoal(event.target.checked)} />Show goal</label>}</header>
    {average.isPending && <p className="chart-help" role="status">Loading {windowDays}-day average...</p>}
    {average.isError && <div className="chart-help"><p role="alert">Could not load the {windowDays}-day average. {average.error.message}</p><button className="secondary-button" disabled={average.isFetching} onClick={() => void average.refetch()}>Retry average</button></div>}
    {entries.length || plannedSegment ? <>
      <div className="chart-legend" aria-label="Chart legend"><span><i className="chart-key-weight" aria-hidden="true" />Weight</span>{average.isSuccess && <span><i className="chart-key-average" aria-hidden="true" />{windowDays}-day average</span>}{hasGoalLine && goal && <span><i className="chart-key-target" aria-hidden="true" />{plannedSegment ? 'Planned path to' : 'Current target:'} {goal.target_weight_kg} kg</span>}</div>
      <div className="weight-chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={points} margin={{ top: 16, right: 18, bottom: 8, left: 0 }} accessibilityLayer title="Daily weight measurements" aria-describedby="chart-help">
            <CartesianGrid vertical={false} stroke="var(--ep-semantic-border-subtle)" />
            <XAxis dataKey="timestamp" type="number" scale="time" domain={timeAxis?.domain} ticks={timeAxis?.ticks} interval="preserveStartEnd" allowDataOverflow tickFormatter={(value: number) => shortDate.format(value)} minTickGap={45} tick={{ fill: 'var(--ep-semantic-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis domain={[(min: number) => Math.max(0, Math.floor(min - 1)), (max: number) => Math.ceil(max + 1)]} width={48} tick={{ fill: 'var(--ep-semantic-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
            {hasGoalLine && goal && <ReferenceLine y={plannedSegment ? undefined : goal.target_weight_kg} segment={plannedSegment} ifOverflow="extendDomain" stroke="var(--ep-semantic-chart-target)" strokeDasharray="3 4" label={{ value: `${plannedSegment ? 'Planned path to' : 'Current target:'} ${goal.target_weight_kg} kg`, position: 'insideTopRight', fill: 'var(--ep-semantic-chart-target)', fontSize: 12 }} />}
            <Tooltip labelFormatter={(value) => fullDate.format(Number(value))} formatter={(value, name) => [`${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 })} kg`, name]} contentStyle={{ background: 'var(--ep-semantic-surface)', border: '1px solid var(--ep-semantic-border-control)', borderRadius: 8, color: 'var(--ep-semantic-text-primary)' }} />
            <Line dataKey="weight" type="linear" connectNulls stroke="var(--ep-semantic-text-secondary)" strokeOpacity={0.65} strokeWidth={1.5} strokeDasharray="5 5" dot={() => <g />} activeDot={false} tooltipType="none" legendType="none" isAnimationActive={false} />
            {average.isSuccess && <Line dataKey="average" name={`${windowDays}-day average`} type="linear" connectNulls={false} stroke="var(--ep-semantic-chart-average)" strokeWidth={2} strokeDasharray="8 3" dot={() => <g />} activeDot={false} isAnimationActive={false} />}
            <Line dataKey="weight" name="Weight" type="linear" connectNulls={false} stroke="var(--ep-semantic-chart-trend)" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: 'var(--ep-semantic-chart-trend)' }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p id="chart-help" className="chart-help">Daily measurements · Gray dashed lines connect measurements across unrecorded days. The {windowDays}-day average uses available measurements from that day and the previous {windowDays - 1} days, including days before the selected period. Tap a point or use arrow keys on the chart. Exact values are in the history below.{plannedSegment && ' The planned path is shown at most one calendar month ahead, using your original target date and pace. It is a plan, not a prediction. Measurements and summaries still follow the selected period.'}</p>
    </> : <div className="chart-empty"><p>No measurements in this period.</p><p>Choose another period or log your weight to get started.</p></div>}
  </section>
}
