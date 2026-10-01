# Emberpath Web

The mobile-friendly frontend for Emberpath, with a landing page, the weight journal and an authenticated Nutrition calculator and saved-plan workflow. Nutrition estimates and new seven-day allocations can be reviewed without plan storage; saving and reading plans require the Nutrition database.

Log one weight measurement per date, follow the daily chart, browse your history, edit entries and delete them after confirmation. Measurements are stored by the FastAPI weight service in PostgreSQL. The interface retains the Onyx/Ember identity and distinguishes loading, empty history and request failures. Clerk handles sign-in and account registration; the API enforces measurement ownership. Offline support is not implemented.

The `/weight` page is a compact dashboard: a row of six tiles (measurements, mean weight, first, latest, change and your weight goal), one data panel with **Chart** (default) and **History** tabs, and Import/Export at the bottom. **Log weight** sits in the panel header beside the tabs, and the period selector sits in the same panel. Both tabs use the same period, so the measurement tiles, chart and history describe the same measurements; the active goal remains independent of that filter.

The shared period filter offers 1/2 weeks, 1/3/6/12 months and all time, defaulting to the last month. Weeks include today and the preceding 6/13 days; months start on the matching calendar date (clamped at month end). The History tab shows 10/25/50 entries per page in a bounded scrolling panel. Changing the period returns to the first page but retains the chosen page size; switching tabs keeps the period, rolling-average window, Show goal choice and the History page and page size. The chart always shows all measurements in the selected period, with gaps for unrecorded days. Filtering and pagination currently use the full history returned by the API.

Use **Log weight** to open the entry dialog (a bottom sheet on phones). Row **Actions** in the History tab provide editing and deletion. The tabs follow the WAI-ARIA tab pattern, with arrow keys, Home and End moving between them. The chart supports pointer/touch inspection and arrow-key navigation, with exact values also available in the History tab. Longer explanations (gaps, rolling averages, the planned path and its pace) sit behind information buttons such as **About this chart**, which work by tap, click and keyboard rather than hover. On phones, the period buttons become a dropdown.

## Run the complete app with Docker

Place `Emberpath`, `Emberpath-web`, `Emberpath-weight-service` and `Emberpath-nutrition-service` beside each other. Configure Clerk in the hub's ignored `.env` before using the protected routes. Stop any Vite server first: both modes use port 5173. From the `Emberpath` repository:

```powershell
docker compose up --build -d --wait
```

Open <http://localhost:5173/> for the landing page, <http://localhost:5173/weight> for the journal or <http://localhost:5173/nutrition> for the calculator and plans. Hub Compose starts separate Weight and Nutrition PostgreSQL databases, runs each service's migrations, then starts both APIs and the web container; Nginx sends Nutrition `/api/nutrition/v1/...` to `nutrition-service:8000/api/v1/...` and keeps other `/api/...` calls on the Weight service. Web listens on all network interfaces; the APIs default to loopback ports `8000` (Weight) and `8001` (Nutrition), configurable in the hub `.env`, and both databases remain bound to loopback. Calculator and new-allocation preview requests do not need plan storage; saved-plan reads and writes do. This repository owns the web Dockerfile and Nginx configuration; shared Compose configuration lives in `Emberpath`. See the [shared setup guide](../Emberpath/readme.md) for ports, authentication, persistence and stopping the app.

## Run locally

Requires Node.js 22.19+ (22.x) or 24+ and npm 10+. From `Emberpath`, start the database and API while leaving port 5173 free for Vite:

```powershell
docker compose stop web
docker compose up --build -d --wait weight-service nutrition-service
```

Then run from `Emberpath-web`:

```sh
npm ci
# Create .env.local and set VITE_CLERK_PUBLISHABLE_KEY to your public Clerk key.
npm run dev
```

Open <http://localhost:5173/> for the landing page, <http://localhost:5173/weight> for the journal or <http://localhost:5173/nutrition> for the calculator and plans. Vite listens on `0.0.0.0:5173` and fails if port 5173 is occupied; stop the existing listener instead of using a different port.

The hub Compose service exposes the [Nutrition API](../Emberpath-nutrition-service/README.md) on `127.0.0.1` at `NUTRITION_API_PORT` (default `8001`; a local override of `8002` uses `127.0.0.1:8002`); alternatively run it separately with its own migrated database for backend reload. Configure `CLERK_ISSUER` and `CLERK_AUTHORIZED_PARTIES` for the actual web origin. Protected API requests need a verified Clerk session; unavailable authentication returns `503`. Nutrition active/history reads and plan writes need its database and migrations; the calculator and new seven-day allocation preview do not. Do not put server secrets in the web app.

Vite forwards `/api/nutrition/v1/...` to `http://127.0.0.1:8001/api/v1/...` by default, ahead of the generic `/api` proxy to the weight service on `http://127.0.0.1:8000`. If hub Compose overrides `NUTRITION_API_PORT` (for example, to `8002`), set `NUTRITION_SERVICE_URL=http://127.0.0.1:8002` in the Vite server process before starting it. The optional `NUTRITION_SERVICE_URL` and `WEIGHT_SERVICE_URL` are server process variables, not browser `VITE_*` variables. The containerized web app uses the equivalent, more-specific Nginx Nutrition route, followed by the existing Weight route. For weight backend development with automatic reload, see the [weight backend instructions](../Emberpath-weight-service/README.md).

For a phone on the same Wi-Fi, open the network URL printed by Vite, or find the PC's IPv4 address with `ipconfig` and open `http://<LAN_IP>:5173/weight`. `npm run dev` already enables network access; `npm run dev:lan` does the same. Compose-web is also accessible at this address when using the full Docker setup.

Use the PC's address, not the phone's `localhost`. Keep `VITE_API_URL=/api` so API requests go through the web server; the API and database need no direct network exposure. The PC must remain running, the network must allow connections between devices, and its firewall must allow inbound TCP port 5173 on that network. Configure the exact LAN origin in the backend authorized parties. Clerk development sessions may require a supported local hostname or HTTPS; production authentication requires HTTPS.

## Routes

| Path | Current behavior |
| --- | --- |
| `/` | Public landing page with links to Weight and Nutrition. |
| `/weight` | Weight dashboard (KPI tiles with the goal, a Chart/History data panel, Import/Export); sign-in is required to load private weight data. |
| `/nutrition` | Authenticated Active plan/Calculator/History workspace, opening the active plan when one exists. Staged calculation and server-reviewed seven-day allocation with explicit save, replacement and end actions. No food consumption tracking. Requires a reachable Nutrition service and verified session; saved reads and writes need Nutrition storage. |

## Nutrition workspace

The main tabs are **Active plan**, **Calculator** and **History**. The initial selection opens the active plan when one exists, or the calculator after confirming none exists. Loading and failed saved-plan reads remain explicit, and a delayed response never overrides an explicit tab choice. Once selected, the tab does not change automatically when a plan ends or a background read completes.

The calculator shows one step at a time: **Inputs**, **Preview**, **Weekday targets**, then **Review and save**. Tab switches and Back retain unfinished inputs, the accepted preview and weekday edits. Input changes or successfully changed options invalidate dependent results; an older in-flight response cannot replace newer choices. Account or session changes discard private drafts.

Active targets and the seven-day allocation are compact, with saved-version details expandable in History. Sources, their scope, method versions and normalized inputs remain available through keyboard- and touch-accessible contextual disclosures. Required errors, server risk reasons and save acknowledgment stay visible in review. Both main tablists support arrow keys, Home and End.

## Nutrition preview

The calculator loads methods, formula and activity choices, PAL ranges, source-labeled starting suggestions and a provisional-use notice from the authenticated `GET /api/nutrition/v1/estimates/options`. It does not render guessed suggestions when that request fails. `POST /api/nutrition/v1/estimates/preview` sends a chosen method and inputs, returns normalized inputs and targets, and does not create a saved plan or a food-intake record.

The calculated adult method requires an age of 19-120 whole years, manually entered weight of 20-400 kg, height of 100-250 cm, an explicitly selected male/female equation parameter and a general activity category. It shows Mifflin-St Jeor resting energy separately from the 2023 adult maintenance estimate. The manual method, for eligible adults when calculated methods are unsuitable, uses a manually chosen 1-20,000 kcal/day base target rather than claiming an expenditure estimate; it needs no height, formula or activity. Neither method reads the Weight journal or infers an equation parameter from Clerk.

The adjustment is user-entered (no deficit/surplus presets); protein can be edited per kg or as fixed daily grams, fat share as a percentage, and fibre as daily grams. The UI converts the displayed fat percentage to the API's `fat_share` fraction. The backend validates all numeric limits and rejects unsupported ages, out-of-range final targets or infeasible nutrient allocations with `422` instead of changing a user's inputs. These bounds are technical, not personalized safety limits. Both methods remain provisional and are not medical advice; logged consumption is not implemented.

Per-kg protein uses explicit `+`/`-` and arrow-key controls in `0.1` increments, including `1.6` to `1.7` or `1.5`; manually entered valid precision remains supported. A choice strictly below `1` or above `3 g/kg/day` shows a nonblocking warning, including an equivalent fixed-gram choice divided by the entered weight. Neither boundary itself warns. This product review band is not a safety range, adds no extra acknowledgment or rejection, and does not change service validation or saved snapshots.

An unavailable session (`401`), a forbidden request (`403`) and an unavailable service, storage or authentication (`503`) are distinct failures. Network and calculation errors remain visible, carry a request ID when available, and support retry where access permits. Editing a field clears the previous result; an older in-flight response cannot replace a preview for newer inputs.

## Nutrition plans

After a **new calculator estimate**, a signed-in user can edit seven Monday-to-Sunday kcal values starting at the chosen average. The form shows the remaining weekly kcal without changing another day; it sends the complete, unchanged new estimate response and a balanced seven-integer allocation to `POST /api/nutrition/v1/plans/allocations/preview`. This stateless review recomputes each day's kcal, protein, fat, carbohydrate, fibre and delta on the server, along with the full-week total, risk reason labels and neutral notice. It needs no plan storage; unbalanced, infeasible or stale drafts cannot be saved. The review is provisional and is not food consumed.

Server reasons cover a calculated target below **estimated** maintenance, a manual downward adjustment below the **user-entered base** (not a measured deficit) and uneven weekdays. Each save or replacement with reasons needs its own unchecked, explicit acknowledgment; it resets after edits and cannot be treated as a safety clearance. The user must confirm or correct the browser-suggested IANA time zone; no UTC fallback is assumed. To change the chosen average, run a fresh estimate preview and explicitly replace the active plan, rather than silently recalculating a saved snapshot.

`GET /api/nutrition/v1/plans/active` provides the active plan and revision; `GET /api/nutrition/v1/plans?limit=10&before_version=...` pages through saved versions. **Editing an active saved version** sends its current ID and revision with seven weekdays to the separate DB-backed `POST /api/nutrition/v1/plans/{plan_id}/allocations/preview`, never its accepted estimate snapshot. The server reviews the persisted snapshot without recalculating historical suggestions or notices; this review requires Nutrition storage but does not change a plan. A changed revision or inactive ID requires refreshing active/history and a fresh review; the UI cannot fall back to the stateless route. After a current review, `POST /api/nutrition/v1/plans` saves only when no plan is active; `POST /api/nutrition/v1/plans/active/replacements` explicitly replaces an active version while retaining the ended snapshot in history. That replacement still submits the exact immutable accepted preview from the saved active version, even if estimate copy or defaults have changed. `POST /api/nutrition/v1/plans/active/end` requires confirmation and leaves saved history intact. Successful writes refetch active/history. The service also supports individual-plan and calendar-projection reads; this UI does not expose a calendar or intake log.

Saved-plan reads, writes and active-snapshot allocation review require configured, migrated Nutrition PostgreSQL. `401` means the session cannot be verified; `403` means the service forbids the request. `404` on saved-allocation review means that ID is no longer the user's active plan, `409` means a stale new estimate preview, revision or lifecycle, `422` means invalid or infeasible inputs or missing risk acknowledgment, and `503` means the service is unavailable, including storage or authentication problems; request IDs are shown when available. Failing active/history reads do not hide the storage-independent calculator or invent an empty history. Previously loaded targets, open history details and drafts remain available during transient refresh failures, with visible errors; cached data alone does not authorize ending or saving a plan after a failed status read. An unsuccessful write never appears as a saved plan.

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
- **TanStack Query 5** owns weight history and mutations as well as nutrition options, estimate/allocation previews and saved-plan reads/mutations. Successful weight saves and deletions invalidate the weight history; successful Nutrition plan writes invalidate active/history. Estimate and allocation previews create no persistent state.
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
    ui/               # Landing page, app-level UI and design tokens
    styles.css
  entities/           # Weight and Nutrition request/response types matching their APIs
  features/
    nutrition/
      api/            # Authenticated options, preview, allocation and plan requests
      components/     # Calculator, weekday editor, saved plans and UI tests
      preview-form.ts # Input parsing and client-side validation
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

`src/app/config/env.ts` is the central browser accessor. Weight requests use this base URL followed by `/weight-logs` or `/weight-goals`; Nutrition requests use `/nutrition/v1/estimates/...` and `/nutrition/v1/plans...`. Keep `VITE_API_URL=/api` for the Vite proxy: its nutrition-specific route maps to the Nutrition service's `/api/v1`, while its generic route removes `/api` before forwarding to the weight service. Nginx routes the same prefixes to separate services in Compose. A separate API origin requires that API to allow the browser origin through CORS.

Vite substitutes `VITE_*` values into the browser bundle. They are public configuration, never a place for database passwords, API secrets or private tokens.

## Assets and hosting

The [brand guide](docs/brand/README.md) explains the asset locations. Colors remain in the [token files](src/app/ui/tokens/README.md).

The app uses browser-history routing. Nginx serves `index.html` for app routes such as `/weight` and `/nutrition`. Its more-specific `/api/nutrition/v1/...` route resolves `nutrition-service:8000` at request time and forwards to `/api/v1/...`, including bearer credentials and request IDs; the exact bare prefix returns `404` rather than falling into the Weight proxy. Other `/api/...` requests still go to `weight-service:8000`. Hub Compose now supplies both services; another static host must provide both app-route fallback and separate Nutrition/Weight API proxying. The app assumes hosting at the domain root.

The manifest provides the name, colors and icons. It does not add offline functionality or sync on its own. PWA capabilities and HTTPS deployment will be addressed separately.

## Verification

```sh
npm test
npm run lint
npm run build
```

The component tests use mocked HTTP responses and cover weight loading, failures, creation, editing, duplicate dates and deletion confirmation, the Chart/History workspace, pagination preferences, the goal tile and dialog and the goal look-ahead, plus Nutrition tab defaults, staged calculation, retained drafts, protein controls and warnings, source-labeled inputs, auth/errors, weekday review, risk acknowledgment, plan lifecycle, refresh and storage failures, concurrency and stale-result handling. They do not need a running database. Hub Compose wires both APIs and migrates their separate databases; browser-to-service checks still require matching Clerk authentication configuration.

## Authentication

This is a Vite SPA with declarative React Router, using `@clerk/react`. Sign-in and sign-up open Clerk modals; the account button manages the signed-in session. The journal does not mount until authentication loads and the user signs in. Each API request obtains a current Clerk session token and sends it as `Authorization: Bearer ...`.

Set `VITE_CLERK_PUBLISHABLE_KEY` in ignored `.env.local` for Vite. For Docker, pass it as the build argument of the same name (the shared Compose file does this). The publishable key is public and bundled into the app. Never add `CLERK_SECRET_KEY` to frontend configuration. Rebuild the container after changing the publishable key. Configure matching issuer and allowed web origins in the weight-service.

Query caches and mounted private UI are isolated by Clerk user and session. Signing out or switching accounts discards the previous cache and form state. Provider IDs are not sent as ownership fields; each API verifies the token and scopes saved data to the authenticated user.

## Personal weight goals

The weight page supports one active weight goal per user. The **Weight goal** tile in the KPI row shows the target and its date (or "Not set"); its **Manage goal** or **Set goal** button opens one native dialog (a bottom sheet on phones) to set a target weight, a start date, an optional target date and an optional starting weight, or to mark the goal completed or cancel it. The goal loads independently of the summary, history and chart: while it loads or fails (with **Retry goal**), the other tiles keep working and an unknown goal is never shown as "Not set". Changing a goal preserves the previous goal record on the server. Completion and cancellation require confirmation, remove the current chart target and keep the previous goal saved; there is no permanent delete, and a goal-history view is not yet provided.

A dated goal with a saved starting weight shows a lavender planned path and the weekly/fortnightly pace supplied by the backend (in the dialog's **About the planned pace** disclosure). The path is clipped to the selected period plus a look-ahead, without changing its original pace or deadline. For Last week, Last 2 weeks and Last month the chart looks ahead by half of the calendar dates the period covers, rounded down: 3 days for a week, 7 for 2 weeks and, for a month, half of its actual inclusive date count (16 days for 32 dates). For 3, 6 and 12 months and all time it looks ahead one calendar month (clamped at month end), not half of the range. The look-ahead never goes past the goal's target date. If the dated path falls wholly outside the visible period or preview, the chart explains why rather than drawing a fabricated flat target or extending the axis. Undated goals, and legacy dated goals without a calculated plan, keep the existing flat-target fallback. Use Show goal to hide the goal line, any off-window explanation and any chart range added only for the goal, restoring the measurement-only scale. Measurements and summaries remain filtered by the selected period. This is a plan, not a forecast or a prescribed rate of weight change. No target is reached automatically. Goal requests use the authenticated `/weight-goals` API and a user/session-scoped query cache; saving, completing or cancelling refetches the current goal instead of trusting the response as state.


The chart's Rolling average selector offers 7, 14 and 30 calendar days (default 7). Values come from the backend; each window has a separate query cache entry. The selection stays active when changing the measurement period or switching between Chart and History, and resets on page remount.

## Measurement files

Import file accepts UTF-8 delimited text (`.csv` or `.txt`) up to 1 MiB and 10,000 measurement rows. Choose comma, semicolon or tab as the delimiter, regardless of file extension. Comma is selected initially. Use `date,weight,unit` headers with the selected delimiter, ISO dates, decimal points and `kg` or `lb`. The service converts pounds to kilograms. Preview shows normalized values and row errors before any write; fix every error before confirming. Existing dates are skipped by default. Choosing replace requires a fresh preview and explicitly overwrites matching weights. Changes to measurements after preview require another preview before saving.

Import file and Export all history sit together below the data panel. Export all history downloads the signed-in user's complete history in kilograms, independently of the selected period and tab. Choose a comma, semicolon or tab delimiter; each export uses a `.csv` filename, includes the same headers and can be imported again. Import refreshes measurements, summaries and rolling averages. Existing saved goal baselines stay unchanged.
