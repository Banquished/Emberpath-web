import { SignInButton, SignUpButton, useAuth } from '@clerk/react'
import type { PropsWithChildren } from 'react'

export function RequireAuth({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn } = useAuth()
  if (!isLoaded) return <p role="status">Loading your account…</p>
  if (!isSignedIn) return <section className="auth-welcome" aria-labelledby="welcome-title">
    <h1 id="welcome-title">Your weight journal</h1>
    <p>Log your daily measurements and follow your progress, at your pace.</p>
    <p>Sign in to open your journal, or create an account to get started.</p>
    <div className="auth-controls">
      <SignInButton mode="modal"><button className="log-button">Sign in</button></SignInButton>
      <SignUpButton mode="modal"><button className="secondary-button">Create account</button></SignUpButton>
    </div>
  </section>
  return children
}
