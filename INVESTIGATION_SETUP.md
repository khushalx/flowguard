# Investigation tools — setup and boundaries

These changes are local and have not been pushed or deployed. They extend the existing execution engine and monochrome interface. Existing runs are preserved. Ordinary checks, deterministic reports and fix prompts do not require OpenAI or Sentry.

## Database rollout

Apply `supabase/migrations/20261028091856_investigation_tools.sql` **once, before deploying this source**. It has been exercised with all existing migrations in local PostgreSQL/PGlite; it has **not** been applied to hosted Supabase.

The migration adds verification links, a journey-history index, AI reservations/usage, in-app notification preferences/events, and issue deduplication. It wraps the existing service-only engine operation to queue original immutable test snapshots. It does not alter previous results, install workflows, grant browser execution writes, create demo data, or send notifications externally. RLS and service-only grants remain enabled. The `private` schema must remain unexposed.

The hosted FlowGuard project already has execution migration version `20261028084831`. Its renamed local filename matches the hosted history; this rename came from the earlier workspace repair. Do not replay the execution migration. The original foundation was installed without corresponding history entries: follow `SETUP.md` to verify/repair that history before CLI `db push`. Do not blindly push every local file or rerun foundation/stabilization SQL. For a fresh database, apply every migration in timestamp order. After the new migration is applied, run hosted security/performance advisors and test cross-workspace access with two accounts.

Review the source, then deploy through the normal reviewed release process. No production schema, deployment, permission or credential was changed for this investigation phase.

## Features that require no new external key

- Unsuccessful terminal runs offer deterministic **Copy fix prompt**, preview and Markdown download, including configuration, infrastructure, timeout and cancellation results.
- Plain-language expected/observed/next-action summaries use recorded evidence. Raw assertion details/logs remain available. Missing evidence is explicit.
- **Compare runs** loads at most the latest 100 runs of the same saved check on demand, including a warning when truncated. It matches immutable behavior, target URL, browser, branch and repository. Legacy snapshots and changed checks are inconclusive. Workflow commit comparisons do not prove the deployed site's commit or a root cause.
- **Verify fix** queues the original saved test through the existing GitHub Actions runner. It does not edit or replace the original outcome. An alternative public deployment URL is permitted after the same SSRF/origin checks; a changed environment cannot resolve the old regression.
- “Regression resolved” requires a genuine complete passing result, the same failed application assertion, all required steps, and comparable configuration. Cancelled, skipped, infrastructure-failed and incomplete runs cannot resolve it. Secret references can rotate independently: checks using protected credential references remain inconclusive until credential-version evidence exists.
- Related failures match journey, snapshot, environment, browser, branch, repository, category, failed step, expected assertion and sanitized error signature. Generic job errors without a failed step are not grouped. Group/ungroup changes the local presentation, not records or the claimed cause. Counts/first-seen times describe the bounded history window.
- Connections → **Notifications** controls the current user's in-app event display. Events contain identifiers and kinds, not page content. New/repeated failures, runner configuration problems and sufficiently verified resolutions are deduplicated per run. No email adapter, background email or automatic issue delivery is enabled.

## Existing secure runner

Follow `ENGINE_SETUP.md` for Actions: write, the repository workflow, `FLOWGUARD_URL`, `FLOWGUARD_RUNNER_REV` (a real reviewed immutable commit), and the repository Actions secret `FLOWGUARD_RUNNER_TOKEN`. This phase adds no new runner credential and does not install a workflow automatically.

After publishing a reviewed runner revision, update the repository's pin or vendored snapshot and workflow manually. Updated templates separate dependency installation, runner build and Chromium installation so GitHub job-step timings can identify setup costs. The runner logs Chromium startup and bounded callback operation/status/duration/attempt metadata, without credentials or payloads. Do not blindly cache browsers or adopt a prebuilt distribution before measuring a real workflow. Input literals are now redacted from evidence as well as protected credentials; screenshot/trace capture is disabled for journeys containing either to avoid leaking typed input.

## Optional OpenAI analysis

Use server-only `OPENAI_API_KEY` to enable **Analyze failure** for workspace owners/admins on unsuccessful completed runs. Without it, there is no functional-looking AI button and no API call. The deterministic prompt remains available.

| Variable                              | Purpose                                                                |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `OPENAI_API_KEY`                      | Server-only OpenAI project key. Never prefix with `NEXT_PUBLIC_`.      |
| `FLOWGUARD_AI_MODEL`                  | Optional model ID; defaults to `gpt-5.4-mini`.                         |
| `FLOWGUARD_AI_INPUT_USD_PER_MILLION`  | Standard input-token price; required when choosing a different model.  |
| `FLOWGUARD_AI_OUTPUT_USD_PER_MILLION` | Standard output-token price; required when choosing a different model. |

The installed SDK is `openai@7.45.1`, using Responses structured output (`responses.parse` + Zod). Model availability and standard prices were checked against the [official model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini) and [structured output guide](https://developers.openai.com/api/docs/guides/structured-outputs). Defaults are $0.75/million input and $4.50/million output tokens; recheck prices before enabling. A different model without explicit positive prices stays disabled. `store:false` is requested; this is not a claim of zero provider retention—review the OpenAI project's actual data policy before enabling.

The review dialog shows exactly the allowlisted evidence being sent: category, action/index, redacted expected/observed text, coverage counts/browser and limited HTTP metadata. It excludes full logs, selectors, URLs, account/repository identifiers, screenshots, traces, test input values and source files. It cannot reliably diagnose source areas without source evidence, so it does not invent them. Evidence is untrusted data; model output is validated text and hypotheses, never executed code.

A reviewed evidence hash is required. Limits are 1,200 output tokens, 20-second provider timeout, no SDK retries, 8,000-byte evidence budget, 5 reservations/minute, 20/day and $1 reserved/workspace/day. Database row locking serializes quota checks. Run/evidence/model uniqueness deduplicates concurrent requests. Successful results cache; pending or failed requests retain their reservation to avoid duplicate charges. Usage and estimated cost are stored when provided; failed requests may have unknown actual usage and retain the conservative reserved amount. Limits use the database's UTC day. There is no automatic paid retry or retry-unlock UI. Provider failure does not block testing or prompts.

## Optional GitHub Issues

No new permission is required for manual **Copy issue body**. Automatic creation is never performed. A user must open the issue dialog, check permission, review the current body, then explicitly click **Create GitHub Issue**.

The server requires an owner/admin session, same-origin POST, workspace ownership, a currently connected repository/installation and explicit **Issues: write** on the existing App installation. If absent, it offers the copyable body and does not request any permission change. If the owner elects to enable this integration later, add only repository Issues: write in GitHub App settings and approve the updated selected-repository installation. Existing Actions tokens remain unchanged. Issue-specific tokens request only metadata read/issues write for the single repository ID.

A server-generated body hash prevents posting changed evidence without review. A unique reservation prevents duplicate creation. If an external response is ambiguous, inspect GitHub manually; automatic retry stays locked to avoid duplicates. No broad PAT, Contents write, organization access or additional permission is requested by this implementation.

## Optional Sentry

Sentry is opt-in. No Sentry organization/project was created, DSN configured or paid plan enabled during this work. Check the current [Developer/free plan limits](https://sentry.io/pricing/) in your account before enabling ingestion. The SDK is a free dependency; hosted quota/overages depend on the chosen service plan. No upgrade is required for the implemented local features.

- `SENTRY_DSN`: optional server ingestion DSN.
- `NEXT_PUBLIC_SENTRY_DSN`: optional public client ingestion DSN; it is an ingestion identifier, not a private Sentry API token. A new build is needed for a public variable change.
- No `SENTRY_AUTH_TOKEN` is required; private source-map upload was deliberately not configured.

Installed `@sentry/nextjs@11.9.0` uses v11 `dataCollection`, with all sensitive categories explicitly disabled. Default integrations, replay, tracing, breadcrumbs, source context, user info, headers/bodies/cookies, query parameters and local variables are disabled. Outbound events are rebuilt from a strict allowlist: constant FlowGuard error kind, request UUID, HTTP status and elapsed milliseconds. Raw messages/stacks/source/routes/customer evidence are discarded. This limits diagnosis to correlated platform events; use restricted platform logs and request identifiers for deeper investigation. Sentry failure must not prevent app startup or a response. Errors may wait up to the SDK's 500ms flush budget when configured; disabled monitoring has no network ingestion.

API responses include `X-Request-Id` and `Server-Timing`. Unexpected auth availability failures, database failures, server/client exceptions, slow endpoints and runner callback failures are platform events. A customer's failed browser assertion is a normal persisted result, not a platform exception. Unconfigured instances continue using sanitized local logs.

## Routes to inspect

- `/demo/runs/run-1038`: local sample summary, fix prompt/preview/download and conservative legacy comparison.
- `/app/projects/[id]`: current check health, problems, recent executions and saved checks.
- `/app/runs/[id]`: real private evidence, comparison, optional analysis/issues and immutable verification.
- `/app/connections`: notification settings and existing connections/runner setup.

See `INVESTIGATION_VERIFICATION.md` for actual test results, measured performance, changed file groups, and remaining external acceptance work.
