import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { paths } from '@/routes/paths'

export function HomePage() {
  return (
    <section aria-labelledby="home-title">
      <title>Home · Emberpath</title>
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">Your space</p>
        <h1 id="home-title" className="mt-3">A home for your progress.</h1>
        <p className="mt-4 text-lg text-text-secondary">Your weight journal and Nutrition calculator are available with sign-in. Review provisional targets, then choose whether to save a plan.</p>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <article aria-labelledby="home-weight-title" className="flex min-w-0 flex-col rounded-2xl border border-border-subtle bg-surface p-6 sm:p-8">
          <p className="text-sm font-semibold text-primary">Available with sign-in</p>
          <h2 id="home-weight-title" className="mt-3 text-xl font-semibold tracking-tight">Weight journal</h2>
          <p className="mt-3 text-text-secondary">Log measurements, view trends, and manage your weight goals in one private space.</p>
          <Link className="primary-link self-start" to={paths.weight}>Go to Weight <ArrowRight size={18} aria-hidden="true" /></Link>
        </article>
        <article aria-labelledby="home-nutrition-title" className="flex min-w-0 flex-col rounded-2xl border border-border-subtle bg-surface p-6 sm:p-8">
          <p className="text-sm font-semibold text-primary">Available with sign-in</p>
          <h2 id="home-nutrition-title" className="mt-3 text-xl font-semibold tracking-tight">Nutrition calculator</h2>
          <p className="mt-3 text-text-secondary">Review source-labeled estimates and editable weekday targets, then save, replace or end a plan. Estimates are provisional, not a safety clearance or consumed intake.</p>
          <Link className="secondary-button mt-7 inline-flex max-w-full items-center justify-center gap-2 self-start text-center hover:bg-surface-hover" to={paths.nutrition}>Go to Nutrition <ArrowRight size={18} aria-hidden="true" /></Link>
        </article>
      </div>
    </section>
  )
}
