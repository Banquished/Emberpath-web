import { ChartNoAxesCombined } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { paths } from '@/routes/paths'

export function AppLayout() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <div className="app-header-inner">
          <Link className="brand-link" to={paths.home} aria-label="Emberpath home">
            <img src="/brand/logos/emberpath-logo.svg" alt="" width="184" height="51" />
          </Link>
          <nav aria-label="Main navigation">
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' nav-link-active' : ''}`}
              to={paths.weight}
              end
            >
              <ChartNoAxesCombined size={18} aria-hidden="true" />
              Weight
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="app-main" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="app-footer">
        <span>Emberpath</span>
        <span>Your personal health journal.</span>
      </footer>
    </div>
  )
}
