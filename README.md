# FlowGuard

Deployment safety and web testing, built with Next.js 16 App Router, TypeScript, Supabase Auth/PostgreSQL, GitHub OAuth, a separate GitHub App, Tailwind CSS 4, and Lucide. The monochrome UI uses Instrument Sans and IBM Plex Mono with an original folded-F identity.

## Start

```sh
npm install
npm run dev
```

Open [localhost:3000](http://127.0.0.1:3000). Follow [SETUP.md](SETUP.md) for every Supabase, OAuth, GitHub App, environment and webhook configuration step. No external services were provisioned. Without credentials, the public homepage and explicitly labeled local demo work; private routes redirect to a configuration-aware login page.

## Routes

| Route                                           | Purpose                                                       |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `/`                                             | Public homepage and read-only interactive failure showcase    |
| `/login`                                        | GitHub sign-in, PKCE start and recoverable auth errors        |
| `/app`                                          | Authenticated workspace overview / first-login empty state    |
| `/app/projects`                                 | Persistent project list and search                            |
| `/app/projects/new`                             | Validated setup and verified repository selection             |
| `/app/projects/[id]`                            | Project configuration, journeys and run history               |
| `/app/projects/[id]/journeys`                   | Persistent journey creation, editing and deletion             |
| `/app/runs`, `/app/runs/[id]`                   | Actual stored runs; empty until execution exists              |
| `/app/connections`                              | GitHub refresh/disconnect/reconnect and explicit local import |
| `/demo`                                         | Separate browser-only sample/local workspace                  |
| `/demo/runs/run-1038`                           | Authored failure evidence fixture                             |
| `/auth/login`, `/auth/callback`, `/auth/logout` | Server-side session lifecycle                                 |
| `/api/github/setup`, `/api/github/webhook`      | Verified installation callback and signed lifecycle events    |

## Phase 2 behavior

Every `/app` route requires verified authentication. Supabase cookie sessions refresh through Next.js 16 Proxy, while server layouts and APIs call `getUser()` before reading or mutating data. A constrained private bootstrap function creates a profile and one personal workspace idempotently, using the trusted GitHub identity from `auth.identities`.

Projects and journeys persist in PostgreSQL through a typed UI adapter. All server mutations validate Zod input and workspace role; RLS independently enforces membership. Owners/admins can edit, members can read, and clients cannot promote membership, change verified identities, write installation metadata, or fabricate runs. Target URLs are validated but never fetched by the server.

GitHub OAuth identifies the user. The separate GitHub App grants read-only repository metadata access. Installation state is user/workspace-bound, ten-minute and single-use. Personal account ownership is verified against immutable GitHub IDs. Organizations are explicitly unsupported. Installation tokens remain server-side and ephemeral. Repository links are reverified against GitHub on save. Webhook signatures use original bytes and timing-safe comparison; PostgreSQL atomically deduplicates delivery IDs and applies access invalidation. Repository additions require a live refresh; removed installations cannot be revived by stale events.

The account menu exposes identity, connections, explicit import, refresh, separate demo and logout. Browser sample data never becomes real account data. The optional import previews only the previous `local` projects/journeys, validates and deduplicates them transactionally, and excludes runs and repository text claims.

## Demo and unavailable execution

`/demo` preserves the original 3 sample projects, 7 journeys and 10 authored run fixtures, plus independent demo/local browser storage under `flowguard.workspace.v1`. Workspace switching, CRUD, search, filters, dialogs, evidence expansion and keyboard interactions remain functional. Clearing browser storage removes local demo edits. `NEXT_PUBLIC_DEMO_MODE=false` chooses an empty demo workspace for a fresh browser; it never bypasses authentication.

No real browser tests run yet. Run tests / Run again explain Phase 3 availability and create no results. No AI diagnosis, recording, payments or billing is implemented. Screenshot SVGs are labeled illustrative fixtures. Live OAuth, hosted Supabase and GitHub API/webhook integration require owner configuration and remain unverified in this checkout.

## Structure

- `src/lib/server/` — authenticated authorization, database adapter, mutation validation, GitHub verification, signature helpers and safe API errors.
- `src/lib/supabase/` — SSR, browser and server-only administrative clients.
- `src/lib/workspace-store.tsx` — shared UI contract and authenticated data provider.
- `src/lib/demo-store.ts` — isolated legacy browser adapter, used only by `/demo`.
- `src/lib/model.ts`, `contracts.ts` — typed domain schemas and request validation.
- `supabase/migrations/` — versioned schema, constraints, grants, RLS and transactional RPCs.
- `src/components/` — existing UI plus account, connection, repository-picker and import interactions.
- `src/app/fonts/`, `public/brand/` — local fonts/licenses and flat identity. The landing sculpture uses lightweight SVG/CSS with reduced-motion/static mobile behavior; no 3D engine is loaded.

## Checks

```sh
npm run test:security
npx playwright install chromium
npm run test:e2e
npm run test:integration
npm run lint
npm run typecheck
npm run build
```

Security tests execute the migration in a real PostgreSQL engine (PGlite), with minimal Supabase Auth/JWT stubs. GitHub API tests mock ownership responses, metadata-only token creation and paginated repository lists. The integration suite runs a separate local Auth/PostgREST fixture backed by the actual SQL migration: it exercises PKCE, cookies, authenticated CRUD, explicit import/deduplication, logout and session revocation on desktop/mobile. OAuth and the HTTP gateway are mocks; this does not verify hosted Supabase or live GitHub. Browser regression tests also cover public/private routing, demo persistence, responsive layouts and axe accessibility. See SETUP.md for the live two-account procedure. Production starts with `npm run start` after building.
