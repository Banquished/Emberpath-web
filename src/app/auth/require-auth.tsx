import { SignInButton, SignUpButton, useAuth } from '@clerk/react'
import type { PropsWithChildren } from 'react'

type SignedOutContent = {
  heading: string
  description: string
  guidance: string
}

const weightSignedOutContent: SignedOutContent = {
  heading: 'Your weight journal',
  description: 'Log your daily measurements and follow your progress, at your pace.',
  guidance: 'Sign in to open your journal, or create an account to get started.',
}

export function RequireAuth({ children, signedOutContent = weightSignedOutContent }: PropsWithChildren<{ signedOutContent?: SignedOutContent }>) {
  const { isLoaded, isSignedIn } = useAuth()
  if (!isLoaded) return <p role="status">Loading your account…</p>
  if (!isSignedIn) return <section className="auth-welcome" aria-labelledby="welcome-title">
    <h1 id="welcome-title">{signedOutContent.heading}</h1>
    <p>{signedOutContent.description}</p>
    <p>{signedOutContent.guidance}</p>
    <div className="auth-controls">
      <SignInButton mode="modal"><button className="log-button">Sign in</button></SignInButton>
      <SignUpButton mode="modal"><button className="secondary-button">Create account</button></SignUpButton>
    </div>
  </section>
  return children
}
