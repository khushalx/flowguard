# Phase 3 verification — 28 October 2026

The application is deployed. On 28 October 2026, the execution-engine migration was applied to hosted Supabase to repair a deployment/schema mismatch; the authenticated production overview now loads successfully.

| Check                                                         | Result                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Standalone runner TypeScript compilation                      | Passed                                                                   |
| Root TypeScript / Next route type generation                  | Passed                                                                   |
| ESLint                                                        | Passed                                                                   |
| Next production build                                         | Passed                                                                   |
| Runner tests with real Chromium                               | 9 passed                                                                 |
| PostgreSQL security and database tests                        | 40 passed                                                                |
| Server unit/integration tests                                 | 9 passed                                                                 |
| Public/demo desktop and mobile browser tests                  | 52 passed                                                                |
| Production-server authenticated desktop/mobile suite          | 22 passed; 2 additional editor regression cases passed in a targeted run |
| Runtime dependency audit and complete runner dependency audit | No known vulnerabilities reported                                        |
| Whitespace/diff check                                         | Passed                                                                   |

134 automated checks passed across these suites. The production-server suite builds a separate Next production application and uses the actual SQL migrations in PostgreSQL through PGlite. Its Auth, PostgREST and GitHub HTTP gateways are fixtures. The execution test launches the independently installed runner in a subprocess, performs a real Chromium heading assertion against a local fixture, submits the actual result, verifies idempotent completion and reload persistence, and confirms polling stops. This is **not external Test 10**.

Runner coverage includes all nine actions, a working form and navigation, missing elements, a deliberately broken interaction, real failure PNGs, sanitized traces, invalid selectors/configuration, protected credentials, cancellation, timeouts, private targets and redirect blocking. Security coverage includes browser write restrictions, cross-workspace isolation, single-use claims, token scope/expiry/revocation, terminal result immutability, incomplete passing payload rejection, artifact opt-in/path/size/privacy, project concurrency and rate limits. Earlier Phase 2 auth, repository discovery, callback protection, CRUD, history pagination and performance checks remain passing.

Desktop/mobile editor screenshots were inspected. The editor and execution view passed automated accessibility/overflow checks. A real sanitized trace was opened in the installed Playwright trace viewer in Chromium: action timings loaded without page errors, while network content, form values, snapshots and source resources were absent.

The SQL fixtures do not implement hosted Supabase Storage. Signed upload/download behavior, MIME/size verification against hosted Storage, deployed cron delivery, GitHub's live permission grant and a real external workflow are **unverified externally**. The migration is installed on the hosted project, and security/performance advisors were checked after applying it. The private PNG bucket configuration and browser write restrictions were verified; actual signed artifact transfers remain unverified. External Test 10 is pending the rollout steps in [ENGINE_SETUP.md](ENGINE_SETUP.md). No fake production result or acceptance claim was created.

## Hosted workspace repair — 28 October 2026

The deployed workspace reader selected Phase 3 columns (`journeys.enabled` and the execution fields on `runs`) before the corresponding migration existed in production. This caused the generic database-request error after successful sign-in. Applied the reviewed, additive execution-engine migration once through Supabase; its hosted version is `20261028084831`, and the local filename now matches that history entry. SQL contents are unchanged.

Before and after: 1 workspace, 1 project, 0 journeys, 0 runs. No existing records were deleted or replaced. The existing GitHub sign-in completed and the live `/app` overview displayed the existing project. Authentication, environment variables and application code were unchanged; no redeployment was needed for this repair.

After aligning the local migration filename with hosted history, all 40 security/database tests, TypeScript checks, ESLint and the production build passed again.

Verified the engine RPC is unavailable to the authenticated browser role, direct browser inserts into runs are denied, and private runner credential records remain unreadable. The evidence bucket is private, accepts PNG only, and limits objects to 2 MiB. Advisors reported no new warning/error from this migration; intentional private-table deny-all RLS notices and the pre-existing password-protection warning remain. Live workflow execution, artifact transfers and external Test 10 remain pending.

## First-check usability refinement — 28 October 2026

Implemented locally, not deployed or pushed. Empty projects have one focused starting point; built-in page-load and visible-text checks create validated positive assertions without writing test code. Custom steps remain optional. Previously connected projects start a valid selection from one “Run a check” click. More than five checks opens an explicit bounded selection. Cancelled editors, missing connections, private targets and unavailable setup retain honest recovery states.

First-run setup opens a GitHub file editor with the workflow, canonical FlowGuard URL and an immutable published runner revision prefilled. No customer Actions variables or added App permissions are required for this prepared workflow. Owners still review/commit the file and save one connection key as a GitHub secret; FlowGuard cannot read that secret to verify its value. Manual/vendored installation remains supported. Source SHA verified read-only on GitHub: `e5d1a55e87e55cbcc32c86bb273657bcb3b7b943`. The GitHub editor filename/content prefill was inspected in the signed-in browser without committing a file.

Passed: TypeScript, lint, production build, 38 server tests, 44 SQL/security tests, 11 real-Chromium runner tests, 30 authenticated desktop/mobile integration tests and 52 browser tests. Accessibility and overflow checks cover the new chooser and connection screens. The page-load preset was executed against working and HTTP 503 fixture pages; an HTTP error never produced a pass. Integration GitHub/Auth transports are local fixtures, not a live workflow acceptance claim. No hosted schema, repository workflow, permission, key or deployment was changed. No new migration or environment variable is needed for this refinement.
