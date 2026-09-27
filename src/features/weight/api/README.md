# Weight API boundary

`weight-request.ts` handles current Clerk token acquisition, authenticated fetches, cancellation, and common session/network failures. `weight-logs.ts`, `weight-goals.ts`, and `weight-transfer.ts` own their endpoints, response bodies, TanStack Query hooks, and operation-specific HTTP errors. Only DELETE expects an empty success response; JSON requests treat an empty 204 response as an error. The API base URL comes from `@/app/config/env`. Keep HTTP calls out of components and client-state stores.

Known 422 responses from period summary and rolling-average reads show query-validation guidance without exposing backend details; other history read failures remain service errors. Measurement saves retain their own validation and duplicate-date messages.

Queries are scoped by authenticated user and session. The app additionally isolates each session's query cache and gates the journal until sign-in completes. Ownership comes from the validated identity on the backend, never from a user ID in the request body.

Keep loading, authentication failures, service errors and empty history distinct.
