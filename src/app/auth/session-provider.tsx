import { useAuth } from '@clerk/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState, type PropsWithChildren } from 'react'

function SessionCache({ children }: PropsWithChildren) {
  const [client] = useState(() => new QueryClient())
  useEffect(() => () => { client.clear() }, [client])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

export function SessionProvider({ children }: PropsWithChildren) {
  const { userId, sessionId } = useAuth()
  return <SessionCache key={`${userId ?? 'anonymous'}:${sessionId ?? 'none'}`}>{children}</SessionCache>
}
