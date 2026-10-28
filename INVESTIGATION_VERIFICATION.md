# Investigation phase — verification report

Date: 28 October 2026. Work is local, uncommitted, unpushed and undeployed. No production data, Vercel settings, GitHub permissions, external issues, email, OpenAI request or Sentry ingestion was changed/sent by this phase. Earlier workspace-repair documentation and the execution migration filename repair were preserved.

## Implemented

Deterministic typed fix prompts cover unsuccessful application/assertion, selector, network, timeout, configuration, infrastructure, cancellation and unknown-category terminal results. Copy, preview and Markdown download work without an API. Reports show concise recorded observations, expected behavior, evidence, missing data and the next investigation action. Raw assertion details remain available.

On-demand comparison finds a relevant earlier pass by immutable behavior/environment/configuration and warns when incompatible or truncated. It shows run links, step-status changes, assertion-evidence availability, duration differences and grounded GitHub workflow-commit comparisons. It does not identify an unobserved deployed-site commit or infer causation. Repeated failures can be grouped/ungrouped with conservative signatures and individually inspected.

Fix verification uses the existing secure engine, original saved snapshot and real browser callbacks; editing the current journey cannot silently change the verification. Only a sufficiently comparable complete pass of the same failed positive application assertion resolves the regression. Alternative targets, protected credential references without version evidence, changed tests, cancellations and infrastructure outcomes remain inconclusive. Previous outcomes are immutable.

Project health prioritizes active check problems and recent executions without claiming an untested site is healthy. In-app event preferences and deduplicated events are implemented. Optional AI analysis and manually reviewed GitHub Issue creation are separate actions with server-side authorization, reviewed-payload hashes and deduplication. Optional Sentry captures allowlisted platform events, without replay or customer failure evidence.

## Checks actually run

| Check                                                                       | Result                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run typecheck`                                                         | Passed; Next route type generation + TypeScript                                     |
| `npm run lint`                                                              | Passed, no warnings                                                                 |
| `npm run test:server`                                                       | 36 passed                                                                           |
| `npm run test:security`                                                     | 44 passed against actual SQL migrations and PostgreSQL roles/RLS                    |
| `npm run test:runner`                                                       | 10 passed; actual local Chromium                                                    |
| `npm run runner:build`                                                      | Passed; standalone CLI TypeScript                                                   |
| `npm run test:integration`                                                  | 26 passed in 52.8 seconds, desktop + mobile, local production server                |
| Targeted real failure/verification integration after final security changes | 2 passed, desktop + mobile                                                          |
| `npm run test:e2e`                                                          | 52 passed in 20.4 seconds, desktop + mobile                                         |
| Production `npm run build`                                                  | Passed; isolated `.next-auth-test` output, compiled in 4.4 seconds + TS 1.6 seconds |
| `git diff --check`                                                          | Passed                                                                              |

The production build used `FLOWGUARD_TEST_DIST=.next-auth-test` to avoid overwriting the running local preview. Tests ran through the required RTK wrapper. Expected negative-test logs include denied runner tokens, mocked dispatch failure, missing configuration and revoked installations; none represents an unverified pass.

Coverage includes failed assertion, selector, network, timeout, configuration, infrastructure and interruption prompts; missing evidence; redaction of known input values/tokens/headers/email/URL paths and truncated PEM keys; bounded large logs; passing/nonterminal behavior; older-pass comparison and incompatible versions/environments; protected credential uncertainty; actual failure-to-pass verification after editing the current journey; immutable prior outcome; grouping; RLS cross-workspace denial; AI disabled, provider failure, pending dedup, invalid structured output and quota exhaustion; reviewed issue bodies and exact repository token permissions; event deduplication and notification preferences. The end-to-end fixture runs a real failing Chromium assertion, changes only the fixture website, queues the old snapshot, runs Chromium again and verifies resolution plus a persisted event.

Desktop and phone screenshots were inspected; axe accessibility checks pass on the failure page/dialog and existing screens. An existing step-button accessible-name mismatch was fixed without changing the visual layout. The public/demo tests remain browser-local; authenticated integration Auth and GitHub transports are local fixtures. They are **not** production OAuth, GitHub Actions, OpenAI, Sentry or email acceptance tests.

## Measured performance

Baseline was captured before implementation using the existing production-build performance fixture. The after sample used the same fixture and machine. These are single local observations, not statistically established speedups or production p95. Raw safe benchmark records are in [`docs/investigation-performance.json`](docs/investigation-performance.json).

| Desktop operation                                  |          Before |           After |
| -------------------------------------------------- | --------------: | --------------: |
| `/app` TTFB / DOM interactive / LCP                | 16 / 23 / 32 ms | 11 / 16 / 24 ms |
| `/app/projects/new` TTFB / DOM interactive / LCP   | 28 / 36 / 48 ms | 22 / 30 / 44 ms |
| `/app/runs` TTFB / DOM interactive / LCP           | 36 / 43 / 52 ms | 22 / 31 / 40 ms |
| `/app` transferred encoded JavaScript              |   222,269 bytes |   222,403 bytes |
| `/app/projects/new` transferred encoded JavaScript |   223,897 bytes |   224,028 bytes |
| `/app/runs` transferred encoded JavaScript         |   222,190 bytes |   222,324 bytes |
| Client projects → new-project navigation           |           79 ms |           76 ms |
| Create project, confirmed UI                       |           60 ms |           59 ms |
| Dashboard / new-project / runs backend calls       |      9 / 16 / 9 |      9 / 16 / 9 |
| Create-project backend calls                       |               5 |               5 |

The dashboard's extra encoded JS is 134 bytes. Optional Sentry/OpenAI are disabled for these samples; the client does not load the optional monitoring chunk without a public DSN, and OpenAI stays server-side. No shared authenticated response cache was introduced.

A separate large-log fixture exposed a slow unbounded email-redaction search: about 10,247 ms before bounding the pattern, versus 19 ms in the final run (other runs 17–27 ms). The input has 1,000 very large log strings; prompt processing examines only bounded slices. This is an ad hoc fixture comparison, not a production latency percentile.

Failure analysis fixture, before any external AI request:

| Stage                                                               |     Desktop |      Mobile |
| ------------------------------------------------------------------- | ----------: | ----------: |
| Authorized evidence/history loading + sanitization (excluding auth) |    10.31 ms |     7.29 ms |
| Deterministic prompt construction                                   |     0.28 ms |     0.06 ms |
| Comparison construction                                             |     0.15 ms |     0.02 ms |
| Serialized complete report                                          | 5,408 bytes | 5,409 bytes |
| Chromium startup for the actual failing fixture                     |       63 ms |       63 ms |

`Server-Timing` exposes report total, evidence, template, comparison and endpoint times. Dashboard TTFB includes local request/SSR costs; it is not an isolated React-render span. The two existing Auth checks per initial navigation each cost 0–1 ms in the after fixture; authorization was retained. Database fixture calls were 0–7 ms. Production database network, auth and isolated render percentiles are not established by this fixture.

Implemented performance controls: project/history reads run in parallel after run authorization; history is bounded to 100 + a truncation sentinel and excludes raw historical logs; client receives compact comparison metadata, not configurations; report/AI history loads on demand; AI never runs on page load; a journey-history covering index is additive; result polling still stops at terminal outcomes; existing installation freshness/deduplication and private no-store responses are preserved. Updated workflow templates expose setup stages separately; runner callback logs expose safe status/timing/attempt metadata.

## Actual hosted configuration audit

- Vercel project `khushalxs-projects/flowguard` was inspected read-only. Production pointed to commit `af0e857c5ccaf5a3e0ab3400e88d9bd35adf6cbe`, with Fluid Compute enabled on Hobby (1 vCPU, 2 GB). The dashboard default showed Washington `iad1`, **but its override dialog showed the deployed `vercel.json` pin to `bom1`**. The file override, rather than the unused dashboard default, is the configured region. No setting was changed.
- Supabase project `qdzrguoavcwtrydorqty` was inspected read-only: Mumbai `ap-south-1`, PostgreSQL 17.11. Configured Vercel/Supabase regions therefore match. A previously observed workspace SQL statement mean was approximately 0.72–3.47 ms; this excludes network and does not establish CPU saturation or production p95. The new investigation migration has not been applied remotely or assessed by hosted advisors.
- GitHub CLI read-only audit of `khushalx/flowguard` returned **0 workflows and 0 Actions runs**. No real job exists there to measure queue, dependency installation, runner build, Chromium installation or callback submission latency. Existing hosted project data also did not provide a completed runner acceptance result. These timings remain unverified, not zero.
- Vercel's overview showed 62 function invocations and 0% errors for its displayed six-hour window. That aggregate is not a live end-to-end acceptance result or a latency distribution.

There is no evidence justifying a paid Vercel/Supabase upgrade. The configured regions already match. Do not buy more CPU, change plans, blindly cache browsers, or publish a prebuilt runner based on local fixture numbers. First install a reviewed pinned workflow on a controlled target, collect its queue/job-step timings and safe callback measurements, then determine whether setup dominates. A prebuilt pinned distribution is a later evidence-dependent optimization.

## Changed file groups

- `src/lib/investigation/{evidence,ai}.ts`: deterministic typed explanations/prompts/comparison/grouping and AI allowlist/schema/configuration.
- `src/lib/server/{report-snapshot,reports,analysis,issues}.ts`: immutable version/environment hashes, redaction, authorized bounded reports, AI reservations/provider integration and reviewed issue creation.
- `src/lib/server/{execution,workspace,auth,http,monitoring}.ts`: original-snapshot verification, private run views, platform diagnostics and request correlation. Existing API route handlers are wrapped by the small monitoring boundary.
- `src/app/api/runs/[id]/{report,analysis,issue}/route.ts` and `src/app/api/notifications/route.ts`: new private, no-store endpoints with the existing session/same-origin boundaries.
- `src/components/{failure-tools,notification-settings,project-detail,run-detail,investigation,connections}.tsx` and `src/app/globals.css`: additive UI, disclosure, accessible labels and compact responsive layouts.
- `src/instrumentation{,-client}.ts`, `src/lib/monitoring{,-options}.ts`: optional privacy-restricted server/client monitoring.
- `supabase/migrations/20261028091856_investigation_tools.sql`: additive schema, indexes, RLS, scoped RPCs and event trigger. Original engine logic is retained under a private versioned function and wrapped transactionally.
- `packages/runner/src/{engine,cli}.ts` and both `public/flowguard-workflow*.yml` templates: input privacy and separate safe timing stages; runner isolation is unchanged.
- `tests/server/{investigation,analysis,issues}.test.ts`, `tests/security/investigation.test.ts`, runner/integration/browser tests and fixture transport: meaningful regression/security coverage. Test-only transports cannot be enabled through application routes.
- `package.json` / lockfile: pinned OpenAI and Sentry dependencies; `.env.example` / setup/verification docs: optional configuration, rollout and boundaries. Existing earlier engine migration rename and repair notes are preserved.

## Remaining setup and external acceptance

1. Review the additive investigation migration and repair/verify foundation migration history as described in `INVESTIGATION_SETUP.md` / `SETUP.md`. Apply only missing migrations once; keep the private schema unexposed. Run hosted advisors and two-account RLS checks afterward.
2. Review and release the source through the normal process. This agent did not push, commit or deploy it. Inspect `/demo/runs/run-1038` locally now; private new database features need the new migration before deployment.
3. Publish a reviewed runner commit or vendor its snapshot, install `.github/workflows/flowguard.yml` on the chosen repository default branch, grant only the existing required Actions: write permission, and set the documented repository variables/secret. Run a deliberately failing controlled page, fix the page, verify via **Verify fix**, reload and confirm the old failure is preserved.
4. Optional: set server-only `OPENAI_API_KEY`; use the documented configurable model/prices and quotas. Review the provider's data policy first. Run an explicit reviewed analysis to validate account/model access, actual latency, output quality and metered usage. No paid OpenAI call was made here.
5. Optional: configure Sentry DSNs on an account with reviewed free-tier limits/privacy settings, rebuild for public DSN changes, trigger a harmless controlled platform error, and confirm only allowlisted data arrives. No live Sentry delivery or production source-map upload was tested.
6. Optional: approve only Issues: write on the selected GitHub App installation, review the body and explicitly create a disposable issue to validate the real grant/deduplication. No issue or email was sent. There is no email provider/automation in this phase.

OpenAI API usage is metered and optional. Sentry's SDK is free; hosted usage depends on its current plan/quota. GitHub Actions minutes/storage and the existing Vercel/Supabase plans retain their existing limits. No paid service or infrastructure upgrade was purchased or enabled.
