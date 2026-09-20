# Weight API boundary

`weight-logs.ts` owns weight CRUD requests and TanStack Query hooks. It reads the API base URL from `@/app/config/env` and obtains a current Clerk session token for each request. Keep HTTP calls out of components and client-state stores.

Queries are scoped by authenticated user and session. The app additionally isolates each session's query cache and gates the journal until sign-in completes. Ownership comes from the validated identity on the backend, never from a user ID in the request body.

Keep loading, authentication failures, service errors and empty history distinct.
