import type { WeekdayTarget } from '@/entities/nutrition-plan'
import { weekdayLabel } from '../weekday-label'

const kcal = new Intl.NumberFormat('en-GB')
const delta = new Intl.NumberFormat('en-GB', { signDisplay: 'exceptZero' })
const grams = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })

export function WeekdayTargets({ days, average, weeklyTotal, notice, title, headingLevel = 4 }: {
  days: WeekdayTarget[]
  average: number
  weeklyTotal: number
  notice: string
  title: string
  headingLevel?: 3 | 4
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4'
  return (
    <section className="mt-6" aria-label={title}>
      <Heading className="text-lg font-semibold">{title}</Heading>
      <p className="mt-2 text-sm text-text-secondary">Chosen average: {kcal.format(average)} kcal/day. Planned full-week total: {kcal.format(weeklyTotal)} kcal. These are targets, not food consumed.</p>
      <div className="mt-4 max-w-full overflow-x-auto rounded-xl border border-border-subtle" role="region" aria-label={`${title} table, scroll for nutrients on small screens`} tabIndex={0}>
        <table className="w-full min-w-[640px] border-collapse bg-background text-right text-sm tabular-nums">
          <thead className="text-text-secondary">
            <tr className="border-b border-border-subtle">
              <th scope="col" className="sticky left-0 bg-background px-3 py-2 text-left">Day</th>
              <th scope="col" className="px-2 py-2">Calories</th>
              <th scope="col" className="px-2 py-2">Vs average</th>
              <th scope="col" className="px-2 py-2">Protein</th>
              <th scope="col" className="px-2 py-2">Fat</th>
              <th scope="col" className="px-2 py-2">Carbohydrate</th>
              <th scope="col" className="px-3 py-2">Fibre</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.weekday} className="border-b border-border-subtle last:border-0">
                <th scope="row" className="sticky left-0 bg-background px-3 py-2 text-left font-semibold">{weekdayLabel(day.weekday)}</th>
                <td className="px-2 py-2">{kcal.format(day.target.kcal)} kcal</td>
                <td className="px-2 py-2">{delta.format(day.delta_from_average_kcal)} kcal</td>
                <td className="px-2 py-2">{grams.format(day.target.protein_g)} g</td>
                <td className="px-2 py-2">{grams.format(day.target.fat_g)} g</td>
                <td className="px-2 py-2">{grams.format(day.target.carbohydrate_g)} g</td>
                <td className="px-3 py-2">{grams.format(day.target.fibre_g)} g</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-text-secondary sm:hidden">Swipe or scroll the table sideways for nutrient targets.</p>
      <details className="mt-3 text-sm text-text-secondary">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-info">About these targets</summary>
        <p className="mt-2">{notice}</p>
      </details>
    </section>
  )
}
