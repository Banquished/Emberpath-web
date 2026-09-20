# Emberpath Web

The mobile-friendly frontend for Emberpath, starting with a weight journal.

Log one weight measurement per date, follow the daily chart, browse your history, edit entries and delete them after confirmation. Measurements are stored by the FastAPI weight service in PostgreSQL. The interface retains the Onyx/Ember identity and distinguishes loading, empty history and request failures. Clerk handles sign-in and account registration; the API enforces measurement ownership. Offline support is not implemented.

The shared period filter offers 1/2 weeks, 1/3/6/12 months and all time, defaulting to the last month. Weeks include today and the preceding 6/13 days; months start on the matching calendar date (clamped at month end). The history shows 10/25/50 entries per page in a bounded scrolling panel. Changing the period resets pagination; the chart always shows all measurements in the selected period, with gaps for unrecorded days. Filtering and pagination currently use the full history returned by the API.

Use **Log weight** to open the entry dialog (a bottom sheet on phones). Row **Actions** provide editing and deletion. The chart supports pointer/touch inspection and arrow-key navigation, with exact values also available in the table. On phones, the period buttons become a dropdown.

## Run the complete app with Docker

Place `Emberpath`, `Emberpath-web` and `Emberpath-weight-service` beside each other. Stop any Vite server first: both modes use port 5173. From the `Emberpath` repository:

```powershell
docker compose up --build -d --wait
```

Open <http://localhost:5173/weight>. Compose starts PostgreSQL, runs the database migrations and starts the API and web containers. Web listens on all network interfaces; the API at `localhost:8000` and PostgreSQL remain bound to loopback. This repository owns the web Dockerfile and Nginx configuration; shared Compose configuration lives in `Emberpath`. See the [shared setup guide](../Emberpath/readme.md) for ports, persistence and stopping the app.

## Run locally

Requires Node.js 22.19+ (22.x) or 24+ and npm 10+. From `Emberpath`, start the database and API while leaving port 5173 free for Vite:

```powershell
docker compose stop web
docker compose up --build -d --wait weight-service
```

Then run from `Emberpath-web`:

```sh
npm ci
# Create .env.local and set VITE_CLERK_PUBLISHABLE_KEY to your public Clerk key.
npm run dev
```

Open <http://localhost:5173/weight>. Vite listens on `0.0.0.0:5173` and fails if port 5173 is occupied; stop the existing listener instead of using a different port. The root URL redirects to `/weight`.

Vite forwards `/api` requests to `http://127.0.0.1:8000` by default. The optional `WEIGHT_SERVICE_URL` Vite server process variable overrides that target. The containerized web app uses Nginx to forward `/api` to `weight-service:8000` on the Compose network instead. For backend development with automatic reload, see the [backend instructions](../Emberpath-weight-service/README.md).

For a phone on the same Wi-Fi, open the network URL printed by Vite, or find the PC's IPv4 address with `ipconfig` and open `http://<LAN_IP>:5173/weight`. `npm run dev` already enables network access; `npm run dev:lan` does the same. Compose-web is also accessible at this address when using the full Docker setup.

Use the PC's address, not the phone's `localhost`. Keep `VITE_API_URL=/api` so API requests go through the web server; the API and database need no direct network exposure. The PC must remain running, the network must allow connections between devices, and its firewall must allow inbound TCP port 5173 on that network. Configure the exact LAN origin in the backend authorized parties. Clerk development sessions may require a supported local hostname or HTTPS; production authentication requires HTTPS.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development on port 5173, accessible on the local network. |
| `npm run dev:lan` | Alias for the same network-accessible development setup. |
| `npm test` | Run Vitest and React Testing Library user-flow tests. |
| `npm run typecheck` | TypeScript checks for app and tooling configuration. |
| `npm run lint` | ESLint, React Hooks and React Refresh checks. |
| `npm run build` | Type-check and generate production assets in `dist/`. |
| `npm run preview` | Preview a built app locally; not a production server. |

## How the pieces fit

- **React 19 + TypeScript** render the interface with typed components.
- **Vite** provides the development server and production build.
- **React Router 7**, in declarative mode, owns navigation. Routes are defined in `src/routes/`.
- **TanStack Query 5** owns weight history and mutations. Successful saves and deletions invalidate the history query so it is fetched again from the API.
- **Tailwind CSS 4** uses the Vite plugin and the existing semantic design tokens. Global layout styles live in `src/app/styles.css`.
- **Manrope** is bundled locally through Fontsource. The app does not request fonts from a third-party server.
- **Zustand** is intentionally deferred until there is shared client state that warrants a store. Keep form state local and server data in TanStack Query.

## Structure

```text
src/
  app/
    config/           # Environment access
    layout/           # App header, navigation, content and footer
    providers/        # Query client and browser router
    ui/               # App-level UI and design tokens
    styles.css
  entities/           # WeightLog and request types matching the API
  features/
    weight/
      api/            # HTTP requests, query options and mutation hooks
      components/     # Weight page, entry form and user-flow tests
  routes/             # Central route definitions and paths
  test/               # Shared test setup
  main.tsx
public/
  brand/              # Runtime SVGs, favicons and app icons
  manifest.webmanifest
docs/
  brand/              # Identity reference, original concept and preview
```

Add `shared/` when a component or helper has at least two feature consumers, rather than building abstractions in advance. `@/` resolves to `src/`.

## API configuration

Copy `.env.example` to `.env.local` if you want to override the default:

```dotenv
VITE_API_URL=/api
```

`src/app/config/env.ts` is the central accessor. Requests use this base URL, followed by `/weight-logs`. Keep `/api` for the built-in Vite and Nginx proxies; both remove the `/api` prefix before forwarding to FastAPI. A separate API origin requires that API to allow the browser origin through CORS.

Vite substitutes `VITE_*` values into the browser bundle. They are public configuration, never a place for database passwords, API secrets or private tokens.

## Assets and hosting

The [brand guide](docs/brand/README.md) explains the asset locations. Colors remain in the [token files](src/app/ui/tokens/README.md).

The app uses browser-history routing. Nginx serves `index.html` for app routes such as `/weight`, while forwarding API calls separately. Another static host must provide the same routing behavior. The app assumes hosting at the domain root.

The manifest provides the name, colors and icons. It does not add offline functionality or sync on its own. PWA capabilities and HTTPS deployment will be addressed separately.

## Verification

```sh
npm test
npm run lint
npm run build
```

The component tests use mocked HTTP responses and cover loading, failures, creation, editing, duplicate dates and deletion confirmation. They do not need a running database. Use the complete Compose stack to verify the browser-to-PostgreSQL flow.

## Authentication

This is a Vite SPA with declarative React Router, using `@clerk/react`. Sign-in and sign-up open Clerk modals; the account button manages the signed-in session. The journal does not mount until authentication loads and the user signs in. Each API request obtains a current Clerk session token and sends it as `Authorization: Bearer ...`.

Set `VITE_CLERK_PUBLISHABLE_KEY` in ignored `.env.local` for Vite. For Docker, pass it as the build argument of the same name (the shared Compose file does this). The publishable key is public and bundled into the app. Never add `CLERK_SECRET_KEY` to frontend configuration. Rebuild the container after changing the publishable key. Configure matching issuer and allowed web origins in the weight-service.

Query caches and mounted private UI are isolated by Clerk user and session. Signing out or switching accounts discards the previous cache and form state. Provider IDs are not sent as ownership fields; the API derives ownership from the validated token and maps it to an internal Emberpath UUID.
