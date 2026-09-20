import { ClerkProvider } from '@clerk/react'
import type { PropsWithChildren } from 'react'
import { BrowserRouter } from 'react-router'
import { SessionProvider } from '@/app/auth/session-provider'
import { env } from '@/app/config/env'

export function AppProviders({ children }: PropsWithChildren) {
  if (!env.clerkPublishableKey) return <main className="app-main"><h1>Emberpath</h1><p role="alert">Sign-in is not configured. Set the Clerk publishable key and restart the web app.</p></main>
  return (
    <ClerkProvider publishableKey={env.clerkPublishableKey} signInFallbackRedirectUrl="/weight" signUpFallbackRedirectUrl="/weight" afterSignOutUrl="/weight" appearance={{ variables: { colorPrimary: '#ff8738', colorBackground: '#1b1b1f', colorForeground: '#f5f5f5', colorInput: '#111113', colorInputForeground: '#f5f5f5', colorMutedForeground: '#b7b7bd', fontFamily: 'Manrope Variable, sans-serif', borderRadius: '0.5rem' } }}>
      <BrowserRouter><SessionProvider>{children}</SessionProvider></BrowserRouter>
    </ClerkProvider>
  )
}
