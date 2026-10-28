# FlowGuard Phase 2 setup

No external resources or credentials were created. Without configuration, `/` and `/demo` work, `/app` redirects to `/login`, and login explains the missing setup. Complete the following steps to enable real workspaces.

## 1. Environment and Supabase

```sh
npm install
cp .env.example .env.local
```

Set `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000` locally. Use that exact hostname in the browser: `localhost` is a different cookie/origin boundary. Production uses the canonical HTTPS origin with no path/query. Restart after environment changes; public variables require rebuilding production.

Create or choose your Supabase project. Copy its URL and **publishable** key from Connect / API keys into `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Put its server **secret** key (`sb_secret_...`) in `SUPABASE_SECRET_KEY`. Never prefix a secret key with `NEXT_PUBLIC_`.

Apply the migrations in `supabase/migrations/` in timestamp order. Existing Phase 2 databases need only `20261028000816_stabilize_connections.sql`; do not rerun the foundation SQL. Alternatively, use the pinned CLI:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Inspect pending migrations before confirming a push. Use a fresh project or inspect existing schema conflicts first. Keep `public` exposed through the Data API and **private unexposed**. The migration explicitly grants access, enables RLS on every application table, and inserts no sample runs/data.

Supabase → Authentication → URL Configuration:

- Site URL: your `NEXT_PUBLIC_APP_URL`.
- Redirect allowlist: `http://127.0.0.1:3000/auth/callback`, plus the exact production `https://YOUR_DOMAIN/auth/callback` when deployed. Avoid broad production wildcards.
- Disable anonymous sign-ins and unused providers for this GitHub-only phase.
- Use the default asymmetric JWT signing key. Next.js 16 `src/proxy.ts` refreshes cookies; private data operations also verify the user with `getUser()`.

### Vercel: login says authentication is not configured

The login gate requires exactly these three variables:

| Variable                               | Required value                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Your Supabase project URL. This matches the standard integration name.                                                                                                          |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key starting with `sb_publishable_`. This matches the standard integration name.                                                                      |
| `NEXT_PUBLIC_APP_URL`                  | FlowGuard's canonical HTTPS origin, such as `https://YOUR_DOMAIN`, with no `/login`, callback path, query, or credentials. This is FlowGuard-specific; configure it separately. |

`src/lib/env.ts` validates these settings. `src/app/login/page.tsx` renders the configuration warning and passes the resulting boolean to `src/components/login-form.tsx`, which disables the button when configuration is invalid. The warning identifies failing variable names and formats without printing values. No alternate names such as `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or `NEXT_PUBLIC_SUPABASE_ANON_KEY` are read. A legacy anon JWT placed under the publishable name is rejected; use the actual publishable key.

In Vercel → project → Settings → Environment Variables, ensure all three are available to **Production** for the deployed project. Development-only variables and a local `.env.local` do not configure production. If inspecting a Preview deployment, configure its Preview scope and a matching canonical origin/allowlisted callback too; a production origin will reject POSTs sent from a different preview origin.

After changing variables, create a **new production deployment** of the updated source. Next.js embeds `NEXT_PUBLIC_` values at build time; promoting an old build or merely reloading the page does not update them. Vercel environment changes apply to new deployments, not existing ones. If diagnosing a cached deployment, redeploy with the existing Build Cache unchecked to force a fresh build.

Supabase Auth's Site URL must match `NEXT_PUBLIC_APP_URL`, and its redirect allowlist must include that origin plus `/auth/callback`. The separate GitHub OAuth App's callback remains the Supabase provider callback described below. Neither GitHub App credentials nor `SUPABASE_SECRET_KEY` are required to enable or complete sign-in; those server credentials are for repository connections/webhooks.

This configuration check validates presence/formats; it cannot verify provider settings, project connectivity, or migration installation. If the button is enabled but login subsequently fails, inspect those separate setup steps. Never paste secret values into logs or screenshots while troubleshooting.

## 2. GitHub OAuth login

Create a GitHub **OAuth App** under Settings → Developer settings → OAuth Apps. This is separate from the GitHub App in step 3.

1. Set its name and application homepage URL.
2. Set Authorization callback URL to the value shown in Supabase's GitHub provider panel: `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. This is **not** FlowGuard's `/auth/callback`.
3. Enter its OAuth client ID and secret in Supabase → Authentication → Sign In / Providers → GitHub and enable the provider. These credentials belong there, not in this repository's environment.

Visit `/login` → **Continue with GitHub**. FlowGuard uses server-side PKCE, cookie sessions and validated internal return destinations. The idempotent database bootstrap derives the GitHub provider ID from trusted `auth.identities`, creates the profile and personal workspace atomically, and starts empty. User-editable metadata is never an authorization source.

## 3. GitHub App repository access

Register a separate GitHub App under Developer settings:

- Homepage: canonical application origin.
- Setup URL: `https://YOUR_ORIGIN/api/github/setup`. Enable **Redirect on update**.
- Leave “Request user authorization (OAuth) during installation” off. This phase supports **personal accounts only**, verifying the immutable account ID against the Supabase GitHub identity. Organization and enterprise installations are refused.
- Webhook: `https://YOUR_PUBLIC_ORIGIN/api/github/webhook`.
- Generate a high-entropy webhook secret; put the same value in `GITHUB_WEBHOOK_SECRET`.
- Permissions: **Metadata: Read-only** only (automatic). No Contents, repository writes, Actions, workflow, deployment, or organization permissions are needed.
- Installation and Installation repositories lifecycle events are handled; enable applicable installation events in the registration UI. No push/code events are needed.
- Copy numeric App ID to `GITHUB_APP_ID` and URL slug to `GITHUB_APP_SLUG`.
- Generate a private key and store it server-side as `GITHUB_APP_PRIVATE_KEY`.

Use a quoted PEM with escaped newlines in `.env.local`:

```dotenv
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nYOUR_REAL_KEY_LINES\n-----END RSA PRIVATE KEY-----"
```

Actual multiline values in your hosting provider's secret editor also work. Use the complete downloaded RSA PEM, including header and footer; do not paste the filename, a placeholder, or extra literal wrapping quotes into the hosting editor. Invalid keys disable repository connection with a configuration warning; they do not disable GitHub sign-in. `.env*` and `*.pem` are ignored; never commit secrets. In production, use a server secret manager.

In `/app/projects/new`, FlowGuard first checks for an existing personal GitHub App installation using your verified immutable provider ID. Accessible repositories appear automatically. Choose a repository, enter project details and the target URL, then create the project. If the App is absent, choose **Connect repositories** once. The server creates a ten-minute, single-use state bound to the user/workspace, stores its hash privately, and sets a matching HttpOnly cookie. The callback verifies that state, fetches the installation with App credentials, checks personal ownership and existing workspace claims, and lists repositories with a server-only installation token. Selecting a repository rechecks live access before saving. Tokens are never stored or returned to the UI. The name, URL, repository selection and setup step survive the redirect in workspace-scoped sessionStorage for 30 minutes and contain no credentials. Repository linking is optional.

**Manage repository access** opens the verified installation settings in a separate tab. Return to FlowGuard to refresh automatically, or click **Refresh**. GitHub settings updates without state return to a fresh discovery page; their query-string installation IDs are never claimed. A missing/invalid state on a new installation still fails closed. Discovery is deduplicated within the current provider, and a 60-second workspace-scoped SQL freshness check avoids repeated GitHub calls. Refresh and lifecycle webhooks invalidate freshness. An explicit disconnect remains disconnected until you choose to reconnect.

## 4. Webhooks locally and in production

GitHub cannot call loopback addresses. For live local testing, use an HTTPS tunnel such as `ngrok http 3000`. Use its origin consistently for `NEXT_PUBLIC_APP_URL`, GitHub setup URL, webhook URL, Supabase redirect allowlist, and browser. Restart and restart the flow after origin changes.

The webhook validates original bytes using HMAC-SHA256 and a timing-safe comparison. A database transaction combines delivery-ID deduplication with changes: failure rolls back the claim, allowing retry; duplicates do nothing. Unsupported events are acknowledged without writes. Unknown installations never create workspace claims.

Deletion/suspension invalidates access. Repository removals invalidate matching rows. Additions set a synchronization flag; **Refresh** fetches a complete paginated live snapshot instead of trusting webhook repository claims. Permission changes require reconnection. Stale created events cannot restore removed installations. Every repository link rechecks GitHub, protecting against missed webhooks.

**Disconnect** revokes this FlowGuard connection and marks linked repositories Access required while preserving projects. Uninstalling the App itself happens in GitHub settings. Reconnect verifies ownership/access again. Monitor delivery failures in GitHub and redeliver after recovery. Logs contain event/delivery IDs, not tokens, keys or bodies. Delivery records are retained for replay protection.

## 5. Data and authorization

The UI uses the user's personal workspace. Owners/admins can edit projects and journeys; members are read-only. Client writes cannot change ownership, memberships, verified GitHub IDs, installations, repositories, or execution records. Future team invitations require a separate verified flow. User CRUD uses session/RLS, never the secret key.

Account menu → **Connections & import** → **Import local projects** explicitly previews and imports only the old browser workspace's `local` projects/journeys. Import is validated, transactional and deduplicated using workspace-scoped deterministic IDs and natural keys. Demo projects, sample runs and repository text claims are excluded; local data is kept. Nothing is silently imported.

Targets accept HTTP(S), valid hostnames, and no embedded credentials. The server makes no requests to target URLs. Journeys are definitions only; run tables prepare for Phase 3 and authenticated users cannot fabricate runs.

## 6. Verification

```sh
npm run test:security
npm run test:server
npx playwright install chromium
npm run test:e2e
npm run test:integration
npm run lint
npm run typecheck
npm run build
```

Security tests execute the actual migration in PGlite's PostgreSQL engine with minimal stubs for Supabase Auth schema/JWT plumbing. They exercise cross-user/role RLS, private RPC restrictions, bootstrap, atomic/idempotent import and installation state, and webhook replay/removal behavior. GitHub ownership tests use mocked installation responses; signature tests use raw payload bytes. These do **not** verify hosted Supabase or live GitHub authorization.

Browser tests without credentials cover protected redirects, recoverable auth/configuration errors, demo CRUD/persistence, public routes, responsive layouts, and accessibility.

`test:integration` builds and starts a separate **production** server on 3010, a test-only Auth/PostgREST fixture on 4545, and a measurement proxy on 4546, backed by all actual PostgreSQL migrations. It tests PKCE challenge/verifier exchange, cookie persistence, authenticated CRUD, explicit import/deduplication, logout and revoked sessions on desktop/mobile. Auth and the HTTP gateway are mocked; it does not exercise hosted Supabase or real GitHub login. The fixture is never imported by application source. Generated files use the ignored `.next-auth-test` directory. The integration-only Node preload redirects GitHub REST to the local fixture. Browser tests exercise installation discovery, state/callback validation, draft preservation, repository linking, access changes, rate limits and deletion. Additional Octokit/server tests mock metadata-only token creation, paginated listing, duplicate claims, and immutable ownership. No integration test contacts real GitHub or claims a live grant.

After setup, verify with two GitHub accounts in separate browser profiles:

1. Sign in, reload a deep `/app` URL, sign out, and try expired/cancelled callbacks. Confirm no private data after sign out.
2. Log in again/retry callback: exactly one personal workspace/membership. New accounts must have no demo records.
3. Create/edit/delete projects/journeys, refresh and sign in again to confirm persistence. Run tests must still explain Phase 3 availability.
4. Connect selected personal repositories. Attempt another user's installation ID and an organization installation: both must fail.
5. Add/remove repository access, refresh, uninstall, redeliver webhook, and reconnect. Confirm access-required/removed labels.
6. Redeliver the same webhook: `duplicate: true`; invalid signatures: 401.
7. Attempt cross-workspace CRUD and role promotion with each user's session; expect empty/denied. Run the hosted project's Supabase security advisors after migration.

## Unverified external setup

Automated tests use local fixtures. Validate hosted Supabase migrations, real OAuth/session refresh, repository access and webhook delivery separately after deployment. See [STABILIZATION.md](STABILIZATION.md) for the audit, measured limits and rollout steps. Test execution, recording, AI diagnostics, payments and billing remain outside Phase 2.

References: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [GitHub OAuth](https://supabase.com/docs/guides/auth/social-sign-in/auth-github), [installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation), [webhook signatures](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).


## Stabilization rollout

Apply the additive stabilization migration **before** deploying the new source. It adds read-only, RLS-bound context/latest-run functions, a latest-run index, and installation freshness/disconnect columns. It inserts no projects or results and preserves existing data. Where Supabase's optional auto-RLS event-trigger helper exists, it removes client execution privileges while retaining the trigger and owner access. Inspect the pending SQL, then use `npx supabase db push`, or apply just the new file once in the SQL editor and keep migration history consistent. Run hosted security/performance advisors afterward.

`vercel.json` pins functions to `bom1` (Mumbai), matching this project's Supabase region. A new deployment is required; the region change does not alter an existing deployment. Other deployments should set their region to match their own database. See [Vercel function regions](https://vercel.com/docs/functions/configuring-functions/region).

Routine reads use `workspace_context`; bootstrap runs only on the first sign-in or when context is missing. Saves return confirmed records without a full workspace reload. History loads 50 summaries per page plus the latest result per journey; step evidence loads only on a run details page. No private responses use a shared cache. API workspace responses expose safe `Server-Timing` durations, while slow backend logs contain only service/status/duration.
