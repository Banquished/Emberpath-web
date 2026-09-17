# Emberpath Web

The mobile-friendly frontend for Emberpath, starting with a weight journal.

This first step is an application shell: navigation, the approved Onyx/Ember identity, an empty weight page and a shared provider setup. Weight entry forms, charts, backend calls, authentication and offline support are not implemented yet. The disabled logging action is explicitly labelled in the UI.

## Run locally

Requires Node.js 22.19+ (22.x) or 24+ and npm 10+.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`. The root URL redirects to `/weight`.

For a phone on the same local network:

```sh
npm run dev:lan
```

Open the network URL printed by Vite on your phone. The PC must remain running and its firewall must allow the connection on your private network. This exposes the development server on the local network; it is not a public production deployment.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development, bound to loopback. |
| `npm run dev:lan` | Development accessible on the local network. |
| `npm run typecheck` | TypeScript checks for app and tooling configuration. |
| `npm run lint` | ESLint, React Hooks and React Refresh checks. |
| `npm run build` | Type-check and generate production assets in `dist/`. |
| `npm run preview` | Preview a built app locally; not a production server. |

## How the pieces fit

- **React 19 + TypeScript** render the interface with typed components.
- **Vite** provides the development server and production build.
- **React Router 7**, in declarative mode, owns navigation. Routes are defined in `src/routes/`.
- **TanStack Query 5** is configured once in `AppProviders`, ready to own future server data. The shell does not issue requests or invent empty API results.
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
  entities/           # Shared domain types, once the API contract is agreed
  features/
    weight/
      api/            # Boundary reserved for weight requests and query options
      components/     # Weight page and its empty state
  routes/             # Central route definitions and paths
  main.tsx
public/
  brand/              # Runtime SVGs, favicons and app icons
  manifest.webmanifest
docs/
  brand/              # Identity reference, original concept and preview
```

Add `shared/` when a component or helper has at least two feature consumers, rather than building abstractions in advance. Add test utilities alongside the first behavior that needs them. `@/` resolves to `src/`.

## API configuration

Copy `.env.example` to `.env.local` if you want to override the default:

```dotenv
VITE_API_URL=/api
```

`src/app/config/env.ts` is the central accessor. The value is reserved for the next integration step and is not used for any requests yet. The default relative URL supports future same-origin routing; this shell does not configure a proxy or provide an API at `/api`.

Vite substitutes `VITE_*` values into the browser bundle. They are public configuration, never a place for database passwords, API secrets or private tokens.

## Assets and hosting

The [brand guide](docs/brand/README.md) explains the asset locations. Colors remain in the [token files](src/app/ui/tokens/README.md).

The app uses browser-history routing. A future static host must serve `index.html` for app routes such as `/weight`, while preserving real API and asset responses. The app currently assumes hosting at the domain root.

The manifest provides the name, colors and icons. It does not add offline functionality or sync on its own. PWA capabilities and HTTPS deployment will be addressed separately.

Docker, Docker Compose and backend setup belong to later agreed steps. The sibling repositories are `Emberpath` for shared documentation/orchestration and `Emberpath-weight-service` for the API.
