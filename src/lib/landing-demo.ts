import type { Run } from "./model";

// Independent public showcase fixture. Never written into an existing workspace.
export const loginExample: Run = {
  id: "login-showcase",
  number: 1042,
  projectId: "example",
  journeyId: "login",
  journeyName: "Sign in to an account",
  status: "failed",
  startedAt: "2026-10-28T08:42:00.000Z",
  duration: 7840,
  branch: "fix/auth-redirect",
  commit: "e72a6c1",
  commitMessage: "Update the session redirect",
  environment: "Preview",
  browser: "Chromium · 1440 × 900",
  steps: [
    {
      name: "Open the sign-in page",
      detail: "GET /login returned 200. The sign-in form was visible.",
      status: "passed",
      duration: 860,
    },
    {
      name: "Enter account details",
      detail: "Email and password fields filled with demo fixture data.",
      status: "passed",
      duration: 540,
    },
    {
      name: "Submit the form",
      detail: "Clicked “Sign in”. The browser stayed on /login.",
      status: "passed",
      duration: 1440,
    },
    {
      name: "Verify the dashboard",
      detail: "The dashboard heading was not visible within 5,000ms.",
      status: "failed",
      duration: 5000,
    },
  ],
  assertion: {
    expected: "Welcome back, Alex",
    received: "Your session could not be created",
    locator: 'getByRole("heading", { name: "Welcome back, Alex" })',
    timeout: 5000,
  },
  screenshot: "/demo/login-evidence.svg",
  logs: [
    "[00:00.000] Sample browser execution fixture",
    "[00:00.860] GET /login → 200",
    "[00:01.400] Account fixture entered",
    "[00:02.840] POST /api/session → 401",
    "[00:07.840] Assertion timed out: dashboard heading not visible",
    "[00:07.840] Illustrative screenshot fixture attached",
  ],
};
