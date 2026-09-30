import type { PreviewResponse } from '@/entities/nutrition-preview'

const calories = new Intl.NumberFormat('en-GB')
const grams = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })
const adjustment = new Intl.NumberFormat('en-GB', { signDisplay: 'exceptZero' })

function TargetValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border-subtle bg-background p-4"><dt className="text-sm text-text-secondary">{label}</dt><dd className="mt-2 text-lg font-semibold tabular-nums">{value}</dd></div>
}

export function NutritionResult({ result }: { result: PreviewResponse }) {
  const calculated = result.method === 'nasem_2023_adult_tee'
  const inputs = result.inputs
  const protein = inputs.strategy.protein
  return (
    <section className="mt-7 rounded-2xl border border-border-subtle bg-surface p-5 sm:p-8" aria-labelledby="nutrition-result-title">
      <p role="status" className="text-sm font-semibold text-info">Preview ready. This calculation has not been saved as a plan.</p>
      <h2 id="nutrition-result-title" className="mt-2 text-xl font-semibold">Provisional daily target preview</h2>
      <p className="mt-2 text-sm text-text-secondary">A chosen target is not an expenditure measurement or a record of calories consumed.</p>
      <p className="mt-5 text-sm text-text-secondary">Effective inputs returned by the service: age {inputs.age_years} years, manually entered weight {grams.format(inputs.weight_kg)} kg{calculated ? `, height ${grams.format(result.inputs.height_cm)} cm, ${result.inputs.formula} formula, ${result.inputs.activity.replace('_', ' ')} activity` : ', manual base target'}. Protein: {protein.mode === 'per_kg' ? `${grams.format(protein.g_per_kg)} g/kg/day` : `${grams.format(protein.g_per_day)} g/day`}; fat: {grams.format(inputs.strategy.fat_share * 100)}%; fibre: {grams.format(inputs.strategy.fibre_g_per_day)} g/day.</p>
      <p className="mt-2 break-words text-xs text-text-secondary">Preview method: {result.method} · nutrient method: {result.macro_method}</p>

      <h3 className="mt-7 text-lg font-semibold">Estimates and chosen calories</h3>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border-subtle bg-background p-4">
          <dt className="text-sm text-text-secondary">Provisional resting estimate</dt>
          <dd className="mt-2 text-lg font-semibold tabular-nums">{calculated ? `${calories.format(result.resting_estimate.kcal_per_day)} kcal/day` : 'Not calculated for a manual target'}</dd>
          {calculated && <a className="mt-2 inline-block break-words text-sm text-info underline underline-offset-2" href={result.resting_estimate.source_url}>Mifflin-St Jeor ({result.resting_estimate.method}): {result.resting_estimate.source_id}</a>}
        </div>
        <div className="rounded-xl border border-border-subtle bg-background p-4">
          <dt className="text-sm text-text-secondary">Estimated maintenance</dt>
          <dd className="mt-2 text-lg font-semibold tabular-nums">{calculated ? `${calories.format(result.maintenance_estimate.kcal_per_day)} kcal/day` : 'Not calculated for a manual target'}</dd>
          {calculated && <a className="mt-2 inline-block break-words text-sm text-info underline underline-offset-2" href={result.maintenance_estimate.source_url}>2023 adult TEE ({result.maintenance_estimate.method}): {result.maintenance_estimate.source_id}</a>}
        </div>
        <TargetValue label={calculated ? 'Base target from estimated maintenance' : 'Manually chosen base target (not an estimate)'} value={`${calories.format(result.base_target_kcal)} kcal/day`} />
        <TargetValue label="Your chosen calorie adjustment" value={`${adjustment.format(result.calorie_adjustment_kcal)} kcal/day`} />
        <TargetValue label="Chosen daily calorie target" value={`${calories.format(result.daily_target.kcal)} kcal/day`} />
      </dl>

      <h3 className="mt-7 text-lg font-semibold">Chosen daily nutrient targets</h3>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TargetValue label="Protein" value={`${grams.format(result.daily_target.protein_g)} g/day`} />
        <TargetValue label="Fat" value={`${grams.format(result.daily_target.fat_g)} g/day`} />
        <TargetValue label="Carbohydrate" value={`${grams.format(result.daily_target.carbohydrate_g)} g/day`} />
        <TargetValue label="Fibre" value={`${grams.format(result.daily_target.fibre_g)} g/day`} />
      </dl>
      <p className="mt-4 text-sm text-text-secondary">Carbohydrate is the remainder after protein and fat using approximate 4/9/4 kcal/g. Fibre is included within total carbohydrate, not added separately.</p>
      <p className="mt-5 text-sm text-text-secondary">{result.notice} An existing saved plan stays unchanged until you explicitly save a replacement. Actual consumed totals are not tracked here.</p>
    </section>
  )
}
