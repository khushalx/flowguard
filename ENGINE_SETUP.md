# FlowGuard execution engine

## Default setup in the app

Open a project and choose **Run your first check**. Select **Page loads** or **Text is visible**; custom browser steps remain optional. FlowGuard saves a real structured assertion. The first run guides the repository owner through adding a prefilled workflow and saving one private connection key in GitHub. No repository URL/revision variables need to be entered for the prepared workflow. Once connected, **Run a check** starts saved checks directly; projects with more than five checks choose a batch first.

The prepared workflow pins the published runner source in `src/lib/server/runner-installation.ts`. Keep that SHA reviewed and immutable when updating it. GitHub still requires the user to review/commit the workflow and save `FLOWGUARD_RUNNER_TOKEN`. The app verifies the workflow and its own credential state; it cannot read GitHub's secret value. No Contents write or Secrets write permission is requested. GitHub-owned approval cannot be skipped with the current execution architecture. No migration or new environment variable is required for this UX refinement.

The manual setup below is for custom/vendored installations and troubleshooting.

Phase 3 adds real Chromium execution through a connected repository's GitHub Actions. Vercel coordinates dispatch, scoped authentication, persistence and authorized evidence access; it never launches a browser. `/demo` remains local sample data.

**Rollout status (28 October 2026):** the application is deployed, and the execution-engine migration is installed on the hosted FlowGuard database as version `20261028084831`. The authenticated production overview was verified after repairing the missing migration. External acceptance Test 10 has **not** passed: no live customer workflow has returned a verified result. Complete the runner publication and repository setup below before expecting production execution.

## 1. Review and deploy the application

1. Review the source and `supabase/migrations/20261028084831_execution_engine.sql`. It extends existing journeys/runs, adds batches and private credential verifiers, restricts all client writes to execution data, and creates a private PNG bucket. It inserts no sample results. Existing free-text journeys remain intact and require structured configuration before execution.
2. Verify migration history **before** using `supabase db push`. This project's foundation was originally applied without a history entry. Follow the history repair guidance in `SETUP.md`; do not replay the foundation or stabilization SQL. The current hosted FlowGuard project already has the execution migration; do not replay it. Its local filename matches the version recorded by Supabase. A fresh database needs all migrations in timestamp order. For other existing projects, apply this migration once before deploying this source.
3. Keep the `private` schema unexposed. Run Supabase security/performance advisors after applying the migration. Check `flowguard-evidence` is private with a 2 MiB object limit and PNG MIME restriction. There should be no public or authenticated storage upload/list policy for this bucket.
4. Preserve existing environment variables from `.env.example`: the three public auth settings, server Supabase secret, and GitHub App credentials/webhook secret. Add **`CRON_SECRET`**, a high-entropy server-only value of at least 32 random bytes, in Vercel Production. Never put it in a `NEXT_PUBLIC_` variable or customer workflow.
5. Review and publish the commit containing `packages/runner` and its lockfile. Record the actual immutable 40-character SHA; this guide deliberately contains no invented release SHA. No npm runner package is assumed to exist.
6. Deploy the reviewed app source to Vercel. `NEXT_PUBLIC_APP_URL` must be its canonical HTTPS origin, currently `https://flowguard-alpha.vercel.app`. Runner callbacks must reach this origin without a Vercel preview-protection login or intermediary redirect.

New deployment environment variable: **`CRON_SECRET` only**. Existing Supabase/GitHub App server credentials remain server-only. GitHub App credentials remain unnecessary for OAuth sign-in itself.

## 2. Enable the minimum GitHub App permission

In the **FlowGuard GitHub App**, add repository **Actions: Read and write**. Retain the existing Metadata read access. Save, then have the installation owner approve the requested permission update for the selected repository. Merely editing the App configuration does not upgrade an existing installation grant.

FlowGuard detects a missing grant and displays a setup message. Installation access tokens request only `metadata: read`, `actions: write`, and the specific repository ID. Contents write, Administration, organization-wide access, and workflow auto-installation are not required. Install the workflow manually below. Existing installation/repository lifecycle webhooks remain in use; no new webhook subscription is required by this implementation.

Actions usage, runner availability, artifact storage and minutes depend on the repository's plan and quota. A queued GitHub job is not evidence that a browser test passed.

## 3. Install the repository workflow

The filename must be **`.github/workflows/flowguard.yml`**, committed on the connected repository's **default branch**. Actions must be enabled there. The workflow uses `workflow_dispatch`, not PR code, and has a 20-minute job limit, a single worker, and `contents: read` as its only explicit `GITHUB_TOKEN` permission. Third-party Actions are pinned to immutable commits.

Choose one installation strategy:

### A. Fetch the published standalone source

Copy [`public/flowguard-workflow.yml`](public/flowguard-workflow.yml) to the filename above. It fetches only `packages/runner` from `khushalx/flowguard` at a reviewed immutable commit, runs `npm ci --ignore-scripts`, compiles the CLI, and installs Chromium with its OS dependencies.

In the **customer repository** → Settings → Secrets and variables → Actions → Variables, add:

| Repository variable    | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `FLOWGUARD_URL`        | Canonical HTTPS FlowGuard origin, with no path, query or credentials  |
| `FLOWGUARD_RUNNER_REV` | Real reviewed 40-character lowercase commit SHA containing the runner |

The source repository must be readable by the job. A customer's `GITHUB_TOKEN` does not automatically read a different private repository. Use strategy B when the FlowGuard source is private or cross-repository checkout is unavailable; do not add a broad personal access token just for this setup.

### B. Vendor the standalone package

Copy **only** the reviewed `packages/runner` directory into the customer repository as `.flowguard/runner`, including `package.json`, `package-lock.json`, `tsconfig.json`, and `src/`. Exclude `node_modules`, `dist`, and `artifacts`. Record the source commit SHA in `.flowguard/runner/SOURCE_REVISION`. Review changes before updating this snapshot.

Use [`public/flowguard-workflow-vendored.yml`](public/flowguard-workflow-vendored.yml), saved as the same `.github/workflows/flowguard.yml` filename. It checks out only that snapshot from the customer's default branch and runs the same locked install/build/CLI. Set `FLOWGUARD_URL`; `FLOWGUARD_RUNNER_REV` is unused in this variant. No Next.js application files need to be copied, and no access to the private FlowGuard repository is needed at job runtime.

Both variants intentionally avoid checking out or executing untrusted forked PR code. They test the approved deployed site. Do not add `pull_request_target`, arbitrary shell inputs, moving-branch source installation, or extra token permissions.

## 4. Configure repository-scoped authentication

1. In FlowGuard, link the project to the intended connected personal repository.
2. Open the project's **Run a check** dialog → **Runner setup** as the workspace owner.
3. Generate a runner credential. Copy it immediately; it is displayed once and is never stored in browser storage. FlowGuard stores only its SHA-256 verifier.
4. Save the credential in that repository's **Actions secret** named **`FLOWGUARD_RUNNER_TOKEN`**. Do not save it as a repository variable or workflow input.
5. Return to FlowGuard and choose **Check setup again**.

Credentials expire after 90 days. Rotation/revocation cancels active executions and invalidates their scoped tokens. Replace the repository secret after rotation. Workspace admins can execute tests; only the owner can generate/revoke credentials. Viewers cannot start executions.

The workflow sends only a non-secret `batch_id` dispatch input. Claim authentication verifies the project/repository/workspace association and independently checks the actual GitHub workflow run's repository ID, default branch, event, workflow ID, title and commit. A claim is single-use. Results and artifact authorization use a separate 15-minute token restricted to that execution's runs; the reusable credential cannot directly submit results. Cookies do not authorize runner endpoints.

Never give customer workflows Supabase secret/service-role keys, GitHub App private keys, OAuth credentials, or `CRON_SECRET`.

## 5. Create a first genuine test

Use a small, publicly reachable deployment that you control, ideally a non-production test account and no personal data. The target must use HTTP(S) on port 80 or 443. The MVP permits traffic only to the project's exact origin; redirects to a different origin, third-party APIs/assets, popups, WebSockets and service workers are blocked. Sites depending on cross-origin authentication or assets need a future reviewed origin-allowlist feature. Loopback, private, link-local, reserved and cloud metadata addresses are blocked, including DNS answers and redirects. Browser connections use validated, pinned IP destinations to resist DNS rebinding.

For a first smoke test:

1. Open `/app/projects/[id]` and set the project's target URL to the deployment.
2. Create a journey named **Home heading** with starting path `/`.
3. Keep **Assert text**, choose **Role: heading**, and enter the page's actual heading in **Accessible name** and **Expected value**. Match the deployed page exactly; do not use a guessed heading.
4. Set the step timeout to 5000 ms and overall timeout to 60000 ms. Keep the journey enabled. Save.
5. Click **Run a check**, review setup/skipped journeys, then **Run 1 journey**. A row action can run just one journey; the project action runs all eligible journeys, up to five.
6. The execution page shows persisted queued/running states and the actual GitHub Actions job link. When the runner reports back, the batch and run become passed, failed, error, timed out or cancelled. Open the journey's run row for actual steps, durations, commit, branch and evidence. Reload to verify persistence.

For a login-like form, add Fill Email, Fill Password, Click Sign in, Assert URL contains `/dashboard`, and Assert visible → heading → Dashboard. Use resilient role, label, placeholder, test ID or exact text locators. CSS is an advanced option. A positive assertion is mandatory; navigation alone and an element-count assertion of zero alone cannot produce a valid journey.

### Protected test values

Select **Use runner secret** for sensitive fill steps and enter a name such as `FG_TEST_PASSWORD`. Add the matching repository Actions secret and explicitly map it in the workflow's execution step. The provided template includes mappings for `FG_TEST_EMAIL` and `FG_TEST_PASSWORD`; add only the names your journeys need. Missing secrets produce a configuration error. Password fields reject plaintext fill values at execution time. Secret values are resolved only inside the runner and are never returned to the dashboard.

Screenshot/trace capture is off by default and is always disabled for journeys using protected secret references. This conservative policy prevents authenticated session evidence from leaking credentials or personal data. Non-secret journeys can opt into failure artifacts; use a test deployment without sensitive content and mark sensitive elements with `data-flowguard-sensitive` for screenshot masking. Screenshots cannot be generically scrubbed of every possible piece of personal data.

## 6. Results, artifacts and interruption handling

- A result is persisted only from an authorized scoped callback. A green Actions job with missing callbacks is reconciled as an infrastructure error, never a passing browser result. Duplicate identical results are accepted idempotently; changed terminal results and cross-workspace submissions are rejected.
- Run detail shows the actual assertion error and expected/observed evidence. Console error **content** is omitted; network logs retain origins/statuses rather than response bodies or request headers. Known test secrets, sensitive patterns and URL queries are redacted. There is no AI diagnosis.
- Opted-in failure screenshots upload directly to the **private `flowguard-evidence` Supabase bucket**, under workspace/batch/run paths. Limit: one PNG per run, 2 MiB. The dashboard exposes an authenticated `/api/runs/[id]/screenshot` redirect only after upload metadata is confirmed; authorized signed downloads expire after 60 seconds. No binary payload is proxied through Vercel.
- Opted-in failure traces appear in the **GitHub Actions job → Artifacts → `flowguard-traces-[batch_id]`** for seven days. These are sanitized Playwright action/timing traces, with network bodies, headers, cookies, form parameters, console content, DOM snapshots and resources removed. Raw traces are never uploaded; processing rejects captures/events above 8 MiB and never decompresses captured resources or response bodies. Open a downloaded ZIP locally with `npx playwright show-trace path/to/file.zip`; do not upload it to a public sharing service. The run's GitHub Actions link leads to the artifact; no public trace URL is fabricated. If capture/upload fails, the result/log explains that evidence is unavailable.
- Browser assertion failures and missing elements are distinct from configuration, infrastructure, timeout and cancellation errors. Browser resources close in `finally`; sequential execution, hard timeouts and bounded callback retries limit resource use.
- Cancel execution locks the FlowGuard result as cancelled first, then attempts GitHub cancellation. If GitHub cannot confirm cancellation, stop the job from its Actions page. Lost callbacks, process crashes, revoked repository access and delayed jobs terminate through metadata reconciliation or deadlines.

## 7. Scheduling, limits and retention

`vercel.json` contains a daily `0 0 * * *` call to `/api/engine/reconcile`. Vercel sends `Authorization: Bearer CRON_SECRET`. Missing/incorrect authorization is rejected. Confirm the cron is active after deployment. Do not put its secret in the URL.

Execution/run detail reads reconcile active GitHub metadata at most once per batch per 30 seconds and expire overdue batches. The daily job independently expires overdue batches and deletes up to 50 expired storage objects per invocation through the Storage API, plus expired artifact metadata. Screenshot access is denied after seven days even before physical cleanup. Daily scheduling means inactive executions can retain a stale database label until the next scheduled sweep, and deletion can lag by a day or build a backlog above 50 expired objects/day. For prompt unattended cleanup/reconciliation, arrange a five-minute authenticated call to this same endpoint using an external scheduler or a compatible paid Vercel cron plan; do not assume Hobby supports frequent cron. Increase cleanup capacity deliberately if volume warrants it.

| Limit                                  | Initial value                                                         |
| -------------------------------------- | --------------------------------------------------------------------- |
| Browser/worker                         | Chromium only, one worker; journeys sequential                        |
| Journeys per batch                     | 1–5 enabled, valid definitions                                        |
| Steps per journey                      | 1–30 plus initial navigation                                          |
| Step timeout                           | 500–15000 ms                                                          |
| Journey timeout                        | 1000–120000 ms                                                        |
| Concurrent batches                     | One per project; repository workflow concurrency also serializes jobs |
| Workspace dispatch rate                | 10 batches/hour, enforced transactionally                             |
| Runner endpoint rate                   | 600 authenticated/attempted requests/minute globally                  |
| Runner callback body                   | 200000 bytes, streamed limit                                          |
| Callback retries                       | At most three for transient delivery failures; no retry for 4xx       |
| CLI execution budget                   | 14 minutes after claim; scoped token/active deadline 15 minutes       |
| Workflow job timeout                   | 20 minutes including installation                                     |
| Unclaimed queue deadline               | 30 minutes from dispatch                                              |
| Screenshot / sanitized trace retention | Seven days; cleanup caveat above                                      |

No browser-wide arbitrary JavaScript evaluation, custom shell steps, untrusted PR execution, paid queue service or always-on runner is introduced. The hosted target remains an untrusted website: keep the runner version/browser patched and use limited test accounts.

## 8. Verification and acceptance

From this repository:

```sh
npm ci
npm --prefix packages/runner ci --ignore-scripts
npm run runner:build
npx playwright install chromium
npm run test:runner
npm run test:security
npm run test:server
npm run test:integration
npm run test:e2e
npm run lint
npm run typecheck
npm run build
```

`test:runner` actually launches Chromium against a deterministic local HTTP fixture. Its explicit private-network test seam is trusted test code and is never enabled by the CLI. It covers all nine actions, working form/navigation, missing element, broken interaction, screenshot/sanitized trace, invalid configuration/selectors, protected secrets, timeouts, cancellation, private targets and redirects.

Security tests run the **actual migrations** in PostgreSQL through PGlite with Auth stubs: RLS, service-only RPCs, queue idempotency/concurrency, scoped single-use claims, unauthorized/cross-workspace submissions, duplicate results, crash expiry and revocation. The production-server desktop/mobile suite uses mocked GitHub/Auth/HTTP gateways backed by that SQL. One test launches the independent real Chromium runner against a local fixture, submits its real outcome, reloads the persisted result and checks polling stops. Accessibility and overflow checks cover the editor and execution view. These do not prove hosted Storage, real OAuth, live GitHub grants or external workflow execution.

**External Test 10 acceptance is manual and still pending.** After setup, trigger the smoke journey from the deployed dashboard. Confirm the real GitHub Actions job installs the pinned runner, the claim succeeds, a genuine assertion completes, and Supabase/FlowGuard retain the same outcome after reload. Then deliberately change the expected heading on a test deployment with artifact capture enabled: confirm the failed step, private screenshot and sanitized trace. Test cancellation and credential rotation. Record the deployment/runner SHA, job URL, batch/run IDs and observed outcome without copying credentials. Do not count local mocks as this acceptance test.

Deferred: AI generation/diagnosis, recording, Firefox/WebKit, deployment/PR triggers, automatic workflow installation, organization/team expansion, cross-origin testing, full sensitive traces, payments and billing. Existing demo data never becomes authenticated execution history.
