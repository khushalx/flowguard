# FlowGuard stabilization — 28 October 2026

The stabilization implementation was initially verified locally without pushing source or creating a deployment. During the subsequent sign-in incident, the missing stabilization migration was applied to hosted Supabase and the live personal workspace was verified in the user's browser. The existing interface and product scope are preserved. Customer test execution remains unavailable; the internal regression fixtures do not create customer test results.

## Follow-up: live sign-in failure resolved

The live `/login?error=callback_failed` screen was caused by a deployed-code/database mismatch: `src/app/auth/callback/route.ts` exchanged the OAuth code, then called `requireWorkspace()`, which requested the missing `public.workspace_context()` RPC. The callback's catch returned the generic sign-in error. The hosted project had the foundation schema but neither stabilization RPC nor the two new installation columns.

Applied the reviewed stabilization SQL through Supabase as migration `20261028034001_stabilize_connections`. The repository filename now matches that recorded version; its SQL is unchanged. Verified the functions exist, use security invoker, permit authenticated execution and deny anonymous execution. An authenticated-role, rolled-back RLS query returned exactly one personal context for an existing workspace. Security advisors no longer flag the optional auto-RLS helper's public execution privileges. The existing browser session then loaded the live `/app` Overview successfully without another OAuth grant or a deployment.

The foundation schema was originally applied outside tracked migration history. Before a future CLI push to this existing project, reconcile that foundation entry rather than rerunning its SQL: after confirming the existing schema, use `npx supabase migration repair 20261027215703 --status applied --linked`. The stabilization entry is already recorded and must not be applied again. Fresh databases still need both migrations in order. This incident fix did not change credentials, weaken RLS or delete user data. A fresh OAuth authorization flow was not repeated.

## Audit and causes

| Problem | Root cause and evidence | Implemented fix |
| --- | --- | --- |
| Installed users are sent to installation again | The connection action always created installation state/URL; it never looked up the signed-in personal account's existing installation. Reproduced the unconnected repository step in the live app. | Resolve the immutable, verified GitHub account ID, discover its installation, independently verify ownership, and populate accessible repositories before offering installation. |
| Routine pages perform unnecessary writes and reads | Every workspace request ran bootstrap, updated the profile, then queried membership. The initial snapshot also fetched profile/workspace again and all run steps. Recorded the requests through a local measurement proxy before editing. | Read-only context RPC; bootstrap only when context is absent; selective parallel reads; 50-run history pages plus latest results per journey; fetch steps only on opening a run. |
| Saving reloads the whole workspace | A successful POST was followed by a complete snapshot GET. A failed refresh could incorrectly report the committed save as failed. Baseline project creation made 19 backend requests and two bootstrap calls. | Return database-confirmed records and update local state directly. Prevent duplicate submissions and retain error feedback. |
| Excess auth requests and client bytes | Automatic Link prefetch triggered private-route verification; the live provider imported the demo store and fixtures. | Keep client navigation but disable automatic workspace prefetch; split live and demo providers. Preserve verified auth checks. |
| Confusing errors and retry loops | Rate-limited 403 responses were treated as permission loss. Sync error writes were unchecked; SDK retry/throttle behavior could extend requests. | Distinguish rate limits, removal, permission failure and unavailable services; checked writes; version checks around sync; bounded requests and pagination deadline. |
| Redirects lose progress | The old draft was globally scoped and incomplete; project settings had no redirect draft. | Workspace/project-scoped session drafts, 30-minute expiry, restored selection/details/step. |
| Configuration looks present but fails at runtime | The local GitHub App private key is present but fails Node private-key parsing. The production key was not read or assumed invalid. | Validate actual RSA PEM format and show a useful configuration error containing variable names only. |
| Cross-region round trips | Vercel function settings showed Washington (`iad1`); Supabase project settings showed Mumbai (`ap-south-1`). | Configure `bom1` in `vercel.json` for the next deployment. This is a likely latency contributor; its live benefit has not been measured. |

Reviewed layouts, proxy, route handlers, SSR authentication, schema/RLS/grants, bootstrap/import, GitHub setup/discovery/tokens/webhooks, dependencies and error paths. The landing artwork uses existing SVG/CSS; no heavy 3D library was found in authenticated routes. An old local server's chunk error was caused by replacing its build while it was running and was excluded from production findings.

## Corrected GitHub flow

1. New project opens repository selection and checks verified personal-account access. A fresh, workspace-scoped snapshot is reused for up to 60 seconds. Refresh bypasses freshness; lifecycle status/`needs_sync` invalidates it. An explicit disconnect is respected.
2. An existing installation is verified against the immutable provider ID, claimed only within the authorized workspace, and synchronized. Repository search and private labels remain available. Future projects normally require no installation redirect.
3. If no installation exists, **Connect repositories** creates expiring, single-use state bound to the user, workspace and cookie. After GitHub returns, the server verifies the installation independently before claiming it. The original draft is restored.
4. **Manage repository access** opens the verified installation settings. Return focus or **Refresh** rechecks access. A settings callback without state ignores its supplied installation ID and only requests independent discovery; it cannot grant that ID.
5. Removal, suspension, missing permission, empty access and rate limits have distinct feedback and recovery actions. Projects may remain explicitly unlinked. Repository access is checked again when linking a repository on save.

Organization installations are rejected. Login alone never grants repository access. Installation tokens stay server-side and request metadata-only permission. Existing raw-body HMAC signature checks, replay-safe atomic webhook processing, private RPC boundaries and RLS are retained. Unique claims cannot transfer another workspace's installation. No live GitHub authorization or installation grant was clicked on the user's behalf.

## Changed implementation

- `src/lib/server/github-client.ts`, `github.ts`, `github-repositories.ts`: configuration validation, verified discovery, fresh snapshots, bounded GitHub calls, reconciliation and actionable errors.
- `src/app/api/github/route.ts`, `setup/route.ts`: discover-first actions, secure callback handling and independent settings refresh.
- `src/components/repository-picker.tsx`, `project-setup.tsx`, `project-settings.tsx`: repository-first setup, manage/refresh/retry, scoped draft restoration and submission protection.
- `src/lib/server/auth.ts`, `workspace.ts`, `src/app/api/workspace/route.ts`: read-only context, selective reads and confirmed mutation responses.
- `src/app/api/runs/`, `src/components/run-index.tsx`, `run-detail.tsx`: paginated summaries, latest health preservation, lazy evidence and recoverable detail loading.
- `src/lib/workspace-context.tsx`, `workspace-store.tsx`, `demo-workspace-provider.tsx`, demo layout: separate demo/live code, deduplicated requests, bounded browser API calls and local updates after confirmed saves.
- `src/lib/server/transport.ts`, Supabase clients, `src/proxy.ts`, workspace links: safe timing diagnostics, backend timeouts and reduced prefetch. Webhooks skip session refresh because they authenticate through HMAC.
- Test fixtures/configuration and security/server/browser suites: production-mode authenticated tests and isolated mock services; no application authentication bypass or new runtime dependency.

## Performance evidence

These are representative **local production-build** samples, with Chromium, mocked Auth/GitHub HTTP and the actual migrations executed in PGlite. There is no network throttling. They are not live latency claims or statistical percentiles. The baseline and final runs used the same local measurement approach.

| Desktop measurement | Before | After |
| --- | ---: | ---: |
| `/app` document TTFB | 38 ms | 14 ms |
| `/app` LCP | 52 ms | 28 ms |
| `/app` encoded JavaScript | 215,307 bytes | 191,153 bytes |
| `/app` backend requests | 23 | 9 |
| `/app/projects/new` TTFB / LCP | 33 / 52 ms | 18 / 40 ms |
| `/app/projects/new` encoded JavaScript | 215,743 bytes | 192,792 bytes |
| `/app/runs` TTFB / LCP | 35 / 48 ms | 17 / 40 ms |
| Projects → New project navigation | 72 ms | 77 ms |
| Create unlinked project → visible detail | 108 ms | 62 ms |
| Backend requests during that save/navigation | 19 | 5 |
| Bootstrap calls during that save/navigation | 2 | 0 |

The final mobile sample measured dashboard TTFB/LCP at 11/24 ms, client navigation at 74 ms and creation at 64 ms. Observed initial long-task duration was zero in these samples. Timing varies across runs; creation ranged roughly 58–113 ms in repeated local checks. Request and byte reductions are stronger evidence than these very small timing differences. The new-project route now performs useful installation discovery that the baseline omitted, so it is not identical work.

[Machine-readable measurements](docs/performance/stabilization.json) include desktop/mobile bytes, request counts and local database HTTP durations. `tests/integration/performance.spec.ts` reproduces the after measurements and enforces a 240,000-byte encoded JS budget, bounded request counts, no routine bootstrap writes and no complete snapshot read after creation. Fixture measurements are written to `/tmp/flowguard-performance-after-{desktop,mobile}.json`.

Limits:

- The fixture's HS256 signing makes `getClaims` fall back to Auth requests; hosted asymmetric JWT verification has different request counts. No security verification was removed.
- Local database HTTP requests were at most 7 ms before and 8 ms after in the captured samples. These include the fixture gateway and do not measure hosted SQL execution or cross-region latency.
- Observed interaction event durations topped out at 24 ms desktop and 16 ms mobile. These are lab event samples, **not field INP**. DOM interactive (44 → 19 ms on desktop `/app`) and long-task observations do not isolate hydration CPU cost.
- The inspected Vercel runtime-log window had no entries in the last 30 minutes. Live serverless duration, cold starts, timeouts and authenticated after-deployment latency remain unmeasured. This does not establish absence of production failures.
- Live GitHub API duration is unverified because the local key cannot authenticate. Tests use mocked responses. New backend diagnostics expose service/status/duration for slow or failed requests; workspace API responses expose safe `Server-Timing`. Neither logs payloads, URLs, credentials or cookies.
- Before-change live public `/login` measured TTFB 109 ms, LCP 456 ms and encoded JS 225,030 bytes. It is not comparable to a local authenticated route and is not used as an improvement claim.

## Database migration and security review

Apply `supabase/migrations/20261028034001_stabilize_connections.sql` before deploying this source. It adds:

- `workspace_context()` and `latest_workspace_runs(uuid)`: read-only, security-invoker RPCs governed by existing table RLS, unavailable to anonymous callers.
- A latest-run index and installation `last_synced_at` / `disconnected_at` columns.
- Updated private synchronization/disconnect functions preserving ownership, atomic reconciliation and existing grants.
- Conditional revocation of client execution on Supabase's optional `public.rls_auto_enable()` event-trigger helper. It keeps the trigger and owner access intact and does nothing where that helper is absent.

The migration neither deletes user records nor inserts sample runs. Security tests execute all migrations and verify cross-workspace reads/writes, role restrictions and private RPC denial. Both presence and absence of the optional hosted helper are tested.

Hosted security and performance advisors were inspected read-only. They flagged the optional helper above, disabled leaked-password protection, intentional policy-free private service-only tables, and informational foreign-key/index usage notices. Private service-only tables remain inaccessible to clients; no permissive policies were added. Password protection is not the cause of GitHub-only login behavior. Existing indexes were not dropped based on low usage in a young workspace; no unmeasured index bottleneck is claimed. Re-run advisors after the migration and review remaining FK coverage as data grows.

## Environment

No secret values were printed or copied into this report. No alternate Supabase variable names were introduced.

| Purpose | Variable names |
| --- | --- |
| Sign-in | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL` |
| Server-only repository access | `SUPABASE_SECRET_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` |
| Webhook authentication | `GITHUB_WEBHOOK_SECRET` |
| Demo initial dataset only | `NEXT_PUBLIC_DEMO_MODE` |

The two Supabase public names already match the integration's standard names. GitHub App credentials and the server secret do not gate OAuth sign-in. OAuth App client credentials belong in Supabase's GitHub provider settings. The local `GITHUB_APP_PRIVATE_KEY` must be replaced with a valid GitHub-generated RSA PEM (actual multiline or escaped newlines). Production's key format is unverified; do not rotate or overwrite it solely because the local copy is invalid.

## Verification results

All completed successfully:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:security` — 31 passed.
- `npm run test:server` — 7 passed.
- `npm run test:e2e` — 52 passed, desktop/mobile public/demo/auth-error/accessibility flows.
- `npm run test:integration` — 16 passed against a production Next build, desktop/mobile.
- `git diff --check`

Total: 106 automated tests. Integration coverage includes mocked PKCE/cookies/logout/revocation, actual SQL CRUD/import/RLS, discovered and first installations, denied/spoofed/replayed callbacks, state-free settings updates, restored drafts, private repository selection, access changes, rate limits, removed installations, pagination and lazy evidence. Additional server tests cover duplicate claims, immutable ownership, metadata-only paginated tokens and failures. Desktop/mobile repository UI was visually inspected; browser suites check accessibility and overflow. Successful tests do not prove live provider settings or GitHub permissions.

## Exact rollout

1. Review the new migration, back up the hosted database using the normal process, and apply **only pending migrations** in order. Existing Phase 2 databases need the stabilization file; do not rerun foundation SQL. In a linked CLI environment, inspect `npx supabase migration list`, then run `npx supabase db push`. Alternatively apply the new file once in Supabase's SQL editor and keep migration history consistent. If the CLI rejects `.env.local` formatting, correct dotenv quoting locally; do not paste keys into commands or logs.
2. Confirm the variable names above exist in Vercel's **Production** scope. Keep the canonical HTTPS application origin and exact Supabase callback allowlist aligned. Repair the invalid local private key; inspect the production key securely only if repository configuration fails there. Never expose the server secret or private key through a `NEXT_PUBLIC_` variable.
3. Verify GitHub App registration: Setup URL uses the application's `/api/github/setup`, **Redirect on update** is enabled, webhook uses `/api/github/webhook` with the matching secret, and repository Metadata is read-only. Supabase OAuth's GitHub callback remains the Supabase `/auth/v1/callback`, distinct from the GitHub App setup URL. No additional OAuth scopes or organization permissions are needed for this personal-account implementation.
4. Deploy this verified source as a new Vercel production build. Public environment changes require rebuilding. Confirm functions run in `bom1` and the new schema RPCs resolve. An old build or existing deployment will not pick up `vercel.json` or new environment values.
5. With your own browser, complete any pending GitHub OAuth authorization yourself. Test the already-installed case, a first installation with selected personal repositories, access additions/removals, uninstall/reconnect, cancellation and webhook redelivery. Confirm a new project survives reload and existing private projects remain private. Two separate accounts should never see or claim each other's workspace/installation. Organization installations must fail safely.
6. Run hosted Supabase advisors again, inspect signed webhook deliveries and sanitized Vercel logs, then capture warm authenticated desktop/mobile TTFB/LCP/navigation, actual database/GitHub latency and serverless duration. Compare those live samples before making production performance claims.

Routes to inspect: `/app/projects/new`, `/app/connections`, project settings, `/app/runs`, and an existing `/app/runs/[id]`. `/demo` remains isolated from real account data.
