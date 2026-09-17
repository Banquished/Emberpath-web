# Weight API boundary

Weight requests and TanStack Query options will live here when the service contract is agreed.
Read the base URL from `@/app/config/env`. Keep HTTP calls out of components and client-state stores.

The current shell has no API requests or mock measurements. Do not turn a missing service into an empty response: the real integration must distinguish loading, error and empty states.
