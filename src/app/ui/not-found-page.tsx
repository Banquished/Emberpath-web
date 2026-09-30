import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { paths } from '@/routes/paths'

export function NotFoundPage() {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <title>Page not found · Emberpath</title>
      <p className="text-primary font-semibold">404</p>
      <h1 id="not-found-title">This page isn’t here.</h1>
      <p className="text-text-secondary">Head back to Emberpath to choose an area.</p>
      <Link className="primary-link" to={paths.home}>
        <ArrowLeft size={18} aria-hidden="true" />
        Back to home
      </Link>
    </section>
  )
}
