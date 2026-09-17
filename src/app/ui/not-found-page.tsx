import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { paths } from '@/routes/paths'

export function NotFoundPage() {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <title>Page not found · Emberpath</title>
      <p className="text-primary font-semibold">404</p>
      <h1 id="not-found-title">This page isn’t here.</h1>
      <p className="text-text-secondary">Head back to your weight journal.</p>
      <Link className="primary-link" to={paths.weight}>
        <ArrowLeft size={18} aria-hidden="true" />
        Back to weight
      </Link>
    </section>
  )
}
