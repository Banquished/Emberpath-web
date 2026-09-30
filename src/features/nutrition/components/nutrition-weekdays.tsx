import type { WeekdayTarget } from '@/entities/nutrition-plan'
import { weekdayLabel } from '../weekday-label'

const kcal = new Intl.NumberFormat('en-GB')
const delta = new Intl.NumberFormat('en-GB', { signDisplay: 'exceptZero' })
const grams = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })

export function WeekdayTargets({ days, average, weeklyTotal, notice, title }: {
  days: WeekdayTarget[]
  average: number
  weeklyTotal: number
  notice: string
  title: string
}) {
  return (
    <section className="mt-6" aria-label={title}>
      <h4 className="text-lg font-semibold">{title}</h4>
      <p className="mt-2 text-sm text-text-secondary">Chosen average: {kcal.format(average)} kcal/day. Planned full-week total: {kcal.format(weeklyTotal)} kcal. These are targets, not food consumed.</p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {days.map((day) => (
          <li key={day.weekday} className="min-w-0 rounded-xl border border-border-subtle bg-background p-4">
            <h5 className="font-semibold">{weekdayLabel(day.weekday)}</h5>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-text-secondary">Calories</dt><dd className="text-right tabular-nums">{kcal.format(day.target.kcal)} kcal</dd>
              <dt className="text-text-secondary">Vs average</dt><dd className="text-right tabular-nums">{delta.format(day.delta_from_average_kcal)} kcal</dd>
              <dt className="text-text-secondary">Protein</dt><dd className="text-right tabular-nums">{grams.format(day.target.protein_g)} g</dd>
              <dt className="text-text-secondary">Fat</dt><dd className="text-right tabular-nums">{grams.format(day.target.fat_g)} g</dd>
              <dt className="text-text-secondary">Carbohydrate</dt><dd className="text-right tabular-nums">{grams.format(day.target.carbohydrate_g)} g</dd>
              <dt className="text-text-secondary">Fibre</dt><dd className="text-right tabular-nums">{grams.format(day.target.fibre_g)} g</dd>
            </dl>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-text-secondary">{notice}</p>
    </section>
  )
}
