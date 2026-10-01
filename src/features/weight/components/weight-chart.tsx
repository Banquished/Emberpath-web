import { useId, useState } from 'react'
import { CartesianGrid, ReferenceLine, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WeightGoal } from '@/entities/weight-goal'
import type { RollingAverageWindow } from '@/entities/weight-rolling-average'
import type { WeightLog } from '@/entities/weight-log'
import { chartMeasurements, dateKey } from '../weight-range'
import { chartTimeAxis, goalWindowNotice, visibleGoalSegment, type GoalWindowNotice } from '../weight-chart-window'
import { useWeightRollingAverage } from '../api/weight-logs'
import { InfoDisclosure } from './info-disclosure'

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const fullDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

const goalWindowMessages: Record<GoalWindowNotice, string> = {
  'starts-later': 'Your goal’s planned path starts after the dates shown here, so there is nothing to draw yet.',
  'ended-earlier': 'Your goal’s planned path ended before this period. Choose a longer period to see it.',
  unavailable: 'A planned path is not available for this goal.',
}

interface WeightChartProps {
  entries: WeightLog[]
  start?: string
  end?: string
  previewEnd: string
  goal?: WeightGoal | null
}

interface GoalLine {
  label: string
  y: number | undefined
  planned: boolean
}

function ChartHelp({ windowDays, goalLine }: { windowDays: RollingAverageWindow; goalLine?: GoalLine }) {
  return (
    <InfoDisclosure label="About this chart">
      <ul>
        <li>Gray dashed lines connect measurements across unrecorded days.</li>
        <li>The {windowDays}-day average uses available measurements from that day and the previous {windowDays - 1} days, including days before the selected period.</li>
        <li>Tap a point or use the arrow keys on the chart to inspect a day. Exact values are in the History tab.</li>
        {goalLine?.planned && <li>The planned path uses your original start date, starting weight and target date. It is a plan, not a prediction. It looks ahead half of the selected range for the last week, 2 weeks or month, and one calendar month for longer ranges. It never goes past your target date.</li>}
        {goalLine && !goalLine.planned && <li>The dotted line marks your current target weight. It is not a prediction.</li>}
        <li>Measurements and summaries follow the selected period.</li>
      </ul>
    </InfoDisclosure>
  )
}

function ChartLegend({ averageLabel, goalLabel }: { averageLabel?: string; goalLabel?: string }) {
  return (
    <div className="chart-legend" role="group" aria-label="Chart legend">
      <span><i className="chart-key-weight" aria-hidden="true" />Weight (kg)</span>
      {averageLabel && <span><i className="chart-key-average" aria-hidden="true" />{averageLabel}</span>}
      {goalLabel && <span><i className="chart-key-target" aria-hidden="true" />{goalLabel}</span>}
    </div>
  )
}

export function WeightChart({ entries, start, end, previewEnd, goal }: WeightChartProps) {
  const descriptionId = useId()
  const [windowDays, setWindowDays] = useState<RollingAverageWindow>(7)
  const average = useWeightRollingAverage(start, end, windowDays)
  const means = new Map((average.isError ? [] : average.data?.points ?? []).map((point) => [point.date, point.mean_weight_kg]))
  const points = chartMeasurements(entries).map((point) => ({
    ...point,
    average: point.weight === null ? null : means.get(dateKey(new Date(point.timestamp))) ?? null,
  }))
  const [showGoal, setShowGoal] = useState(true)
  const plannedSegment = showGoal && goal ? visibleGoalSegment(goal, start, previewEnd) : undefined
  const showFlatTarget = showGoal && goal && (!goal.target_date || !goal.plan)
  const goalLine: GoalLine | undefined = goal && (plannedSegment || showFlatTarget)
    ? {
      label: `${plannedSegment ? 'Planned path to' : 'Current target:'} ${goal.target_weight_kg} kg`,
      y: plannedSegment ? undefined : goal.target_weight_kg,
      planned: plannedSegment !== undefined,
    }
    : undefined
  const timestamps = [...points.map((point) => point.timestamp), ...(plannedSegment?.map((point) => point.x) ?? [])]
  const timeAxis = timestamps.length ? chartTimeAxis(timestamps) : undefined
  // A shown goal that has no drawable segment states why, instead of leaving the toggle silently empty.
  const notice = showGoal && goal && !plannedSegment ? goalWindowNotice(goal, start, previewEnd) : undefined
  const goalWindowMessage = notice ? goalWindowMessages[notice] : ''
  return <div className="weight-chart-view">
    <h2 className="sr-only">Your progress</h2>
    <div className="chart-toolbar">
      <label className="chart-average-select">Rolling average<select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value) as RollingAverageWindow)}><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></label>
      {goal && <label className="chart-goal-toggle"><input type="checkbox" checked={showGoal} onChange={(event) => setShowGoal(event.target.checked)} />Show goal</label>}
      <ChartHelp windowDays={windowDays} goalLine={goalLine} />
    </div>
    {average.isPending && <p className="chart-notice" role="status">Loading {windowDays}-day average...</p>}
    {average.isError && <div className="chart-notice"><p className="form-error" role="alert">Could not load the {windowDays}-day average. {average.error.message}</p><button className="secondary-button" disabled={average.isFetching} onClick={() => void average.refetch()}>Retry average</button></div>}
    <p className={goalWindowMessage ? 'chart-notice' : undefined} aria-live="polite" aria-atomic="true">{goalWindowMessage}</p>
    {entries.length || plannedSegment ? <>
      <ChartLegend averageLabel={average.isSuccess ? `${windowDays}-day average` : undefined} goalLabel={goalLine?.label} />
      <p id={descriptionId} className="sr-only">Line chart of daily weight in kilograms for the selected period{average.isSuccess ? `, with a ${windowDays}-day average` : ''}{goalLine ? ' and your goal' : ''}. Tap a point or use the arrow keys to inspect it. Exact values are in the History tab.</p>
      <div className="weight-chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={points} margin={{ top: 16, right: 18, bottom: 8, left: 0 }} accessibilityLayer title="Daily weight measurements" aria-describedby={descriptionId}>
            <CartesianGrid vertical={false} stroke="var(--ep-semantic-border-subtle)" />
            <XAxis dataKey="timestamp" type="number" scale="time" domain={timeAxis?.domain} ticks={timeAxis?.ticks} interval="preserveStartEnd" allowDataOverflow tickFormatter={(value: number) => shortDate.format(value)} minTickGap={45} tick={{ fill: 'var(--ep-semantic-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis domain={[(min: number) => Math.max(0, Math.floor(min - 1)), (max: number) => Math.ceil(max + 1)]} width={48} tick={{ fill: 'var(--ep-semantic-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
            {goalLine && <ReferenceLine y={goalLine.y} segment={plannedSegment} ifOverflow="extendDomain" stroke="var(--ep-semantic-chart-target)" strokeDasharray="3 4" label={{ value: goalLine.label, position: 'insideTopRight', fill: 'var(--ep-semantic-chart-target)', fontSize: 12 }} />}
            <Tooltip labelFormatter={(value) => fullDate.format(Number(value))} formatter={(value, name) => [`${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 })} kg`, name]} contentStyle={{ background: 'var(--ep-semantic-surface)', border: '1px solid var(--ep-semantic-border-control)', borderRadius: 8, color: 'var(--ep-semantic-text-primary)' }} />
            <Line dataKey="weight" type="linear" connectNulls stroke="var(--ep-semantic-text-secondary)" strokeOpacity={0.65} strokeWidth={1.5} strokeDasharray="5 5" dot={() => <g />} activeDot={false} tooltipType="none" legendType="none" isAnimationActive={false} />
            {average.isSuccess && <Line dataKey="average" name={`${windowDays}-day average`} type="linear" connectNulls={false} stroke="var(--ep-semantic-chart-average)" strokeWidth={2} strokeDasharray="8 3" dot={() => <g />} activeDot={false} isAnimationActive={false} />}
            <Line dataKey="weight" name="Weight" type="linear" connectNulls={false} stroke="var(--ep-semantic-chart-trend)" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: 'var(--ep-semantic-chart-trend)' }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </> : <div className="chart-empty"><p>No measurements in this period.</p><p>Choose another period or log your weight to get started.</p></div>}
  </div>
}
