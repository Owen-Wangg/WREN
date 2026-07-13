# WREN Writing Coach — Frontend (`frontend/`)

React 19 + TypeScript (strict) + Vite 7 + Tailwind CSS 4 + shadcn/ui (Radix)
single-page application for the WREN Writing Coach platform.

## Stack

- **React 19 / Vite 7**, TypeScript `strict` (`noImplicitAny`, `strictNullChecks`).
- **Tailwind CSS 4** themed from centralized design tokens.
- **React Query** (`@tanstack/react-query`) for server state.
- **React Hook Form + Zod** for forms and API-boundary validation.
- **React Router** for routing, **lucide-react** for icons.
- `@` path alias → `./src`; shared domain contract from `@wren/types` (task 1.2).

## Scripts

```bash
npm install       # install pinned deps (package-lock.json is committed)
npm run dev       # start the Vite dev server
npm run build     # tsc -b && vite build
npm run typecheck # tsc -b --noEmit
npm run lint      # eslint (incl. the design-token guard)
npm test          # vitest run
```

## Project structure (feature-based)

```
src/
  app/            # providers (React Query client, router shell)
  components/ui/  # shared shadcn/ui primitives (task 17.2+)
  config/         # env.ts — the single application-config source (Req 53.2)
  features/       # <feature>/components — auth, dashboard, editor, debrief …
  forms/          # useZodForm — React Hook Form + Zod
  hooks/          # queryKeys and shared hooks
  lib/            # cn() and small utilities
  services/       # the single Cognito-aware API client (+ mock until convergence)
  styles/         # index.css, theme.css, and tokens/ (single source of truth)
  test/           # vitest setup
```

## Design tokens (single source of truth)

All colors, font sizes, spacing, radii, and shadows are defined in
`src/styles/tokens/*` and mirrored into the Tailwind `@theme` block in
`src/styles/theme.css`. **Raw hex colors and raw `px` font sizes are forbidden
in component `.tsx` files** outside `src/styles/tokens` — the custom ESLint rule
`wren/no-raw-design-values` fails lint on violations. Rebranding or re-theming is
a token-file edit, never a find-and-replace across components.

## Configuration

Configuration comes from build-time `VITE_`-prefixed environment variables
(see `.env.example`; commit `.env.example`, never a real `.env`). The
application display name is read from a single configuration value
(`VITE_APP_NAME`) in `src/config/env.ts` (Requirement 53.2); no brand literal is
hardcoded in the source.

## API access

Every network call goes through the single shared client in `src/services`,
which attaches the Cognito bearer token, normalizes errors into `ApiError`, and
validates every response against a Zod schema at the boundary. Until the backend
converges, `apiClient` resolves to a mock that returns `@wren/types`-shaped
fixtures held to the same schema contract.
