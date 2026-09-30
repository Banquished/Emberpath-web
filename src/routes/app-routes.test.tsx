import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './app-routes'

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: false }))

vi.mock('@clerk/react', () => ({
  useAuth: () => auth,
  Show: ({ children, when }: PropsWithChildren<{ when: string }>) => when === (auth.isSignedIn ? 'signed-in' : 'signed-out') ? children : null,
  SignInButton: ({ children }: PropsWithChildren) => children,
  SignUpButton: ({ children }: PropsWithChildren) => children,
  UserButton: () => <button type="button">Account</button>,
}))

vi.mock('@/features/weight/components/weight-page', () => ({
  WeightPage: () => <h1>Weight dashboard</h1>,
}))

vi.mock('@/features/nutrition/components/nutrition-page', () => ({
  NutritionPage: () => <h1>Nutrition calculator preview</h1>,
}))

beforeEach(() => {
  auth.isLoaded = true
  auth.isSignedIn = false
  vi.stubGlobal('fetch', vi.fn())
})

function renderRoute(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>)
}

describe('app routes', () => {
  it('renders a public landing page at / with honest links to both areas', () => {
    renderRoute('/')
    expect(screen.getByRole('heading', { name: 'A home for your progress.' })).toBeInTheDocument()
    expect(document.title).toBe('Home · Emberpath')
    const weight = screen.getByRole('article', { name: 'Weight journal' })
    expect(within(weight).getByRole('link', { name: 'Go to Weight' })).toHaveAttribute('href', '/weight')
    const nutrition = screen.getByRole('article', { name: 'Nutrition calculator' })
    expect(within(nutrition).getByText('Available with sign-in')).toBeInTheDocument()
    expect(within(nutrition).getByText(/save, replace or end a plan/)).toBeInTheDocument()
    expect(within(nutrition).getByText(/not a safety clearance or consumed intake/)).toBeInTheDocument()
    expect(within(nutrition).getByRole('link', { name: 'Go to Nutrition' })).toHaveAttribute('href', '/nutrition')
    expect(screen.queryByRole('heading', { name: 'Your weight journal' })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('takes signed-out visitors from home to the existing Weight sign-in gate', async () => {
    const user = userEvent.setup()
    renderRoute('/')
    await user.click(screen.getByRole('link', { name: 'Go to Weight' }))
    const main = within(screen.getByRole('main'))
    expect(main.getByRole('heading', { name: 'Your weight journal' })).toBeInTheDocument()
    expect(main.getByText('Sign in to open your journal, or create an account to get started.')).toBeInTheDocument()
    expect(main.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Weight dashboard' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Weight' })).toHaveAttribute('aria-current', 'page')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still mounts the Weight page at /weight for a signed-in visitor', () => {
    auth.isSignedIn = true
    renderRoute('/weight')
    expect(screen.getByRole('heading', { name: 'Weight dashboard' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'A home for your progress.' })).not.toBeInTheDocument()
  })

  it('keeps /nutrition protected while authentication loads and when signed out', () => {
    auth.isLoaded = false
    const view = renderRoute('/nutrition')
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent('Loading your account')
    expect(screen.queryByRole('heading', { name: 'Nutrition' })).not.toBeInTheDocument()

    auth.isLoaded = true
    view.rerender(<MemoryRouter initialEntries={['/nutrition']}><AppRoutes /></MemoryRouter>)
    const main = within(screen.getByRole('main'))
    expect(main.getByRole('heading', { name: 'Nutrition calculator and plans' })).toBeInTheDocument()
    expect(main.getByText('Sign in to calculate targets and save, replace or end your plans.')).toBeInTheDocument()
    expect(main.getByText(/not a record of food consumed or a safety clearance/)).toBeInTheDocument()
    expect(main.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Nutrition calculator preview' })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('mounts the Nutrition preview route only after sign-in', () => {
    auth.isSignedIn = true
    renderRoute('/nutrition')
    expect(screen.getByRole('heading', { name: 'Nutrition calculator preview' })).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('navigates between Nutrition, Weight and the landing page via the existing layout', async () => {
    auth.isSignedIn = true
    const user = userEvent.setup()
    renderRoute('/')
    await user.click(screen.getByRole('link', { name: 'Go to Nutrition' }))
    expect(screen.getByRole('heading', { name: 'Nutrition calculator preview' })).toBeInTheDocument()
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }))
    expect(nav.getByRole('link', { name: 'Nutrition' })).toHaveAttribute('aria-current', 'page')
    await user.click(nav.getByRole('link', { name: 'Weight' }))
    expect(screen.getByRole('heading', { name: 'Weight dashboard' })).toBeInTheDocument()
    expect(nav.getByRole('link', { name: 'Weight' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('link', { name: 'Emberpath home' }))
    expect(screen.getByRole('heading', { name: 'A home for your progress.' })).toBeInTheDocument()
  })

  it('returns from an unknown route to the new home', async () => {
    const user = userEvent.setup()
    renderRoute('/missing')
    await user.click(screen.getByRole('link', { name: 'Back to home' }))
    expect(screen.getByRole('heading', { name: 'A home for your progress.' })).toBeInTheDocument()
  })
})
