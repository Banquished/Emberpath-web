export const env = {
  clerkPublishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() || '',
  apiBaseUrl: import.meta.env.VITE_API_URL?.trim() || '/api',
}
