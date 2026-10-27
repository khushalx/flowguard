import type { Run, Storage, Workspace } from "./model";

export const emptyWorkspace = (): Workspace => ({
  projects: [],
  journeys: [],
  runs: [],
});

export function createDemo(): Workspace {
  const ago = (minutes: number) =>
    new Date(Date.now() - minutes * 60000).toISOString();
  const projects = [
    {
      id: "ledger",
      name: "Ledger",
      url: "https://ledger.example.com",
      repository: "acme/ledger",
      description: "Billing and subscriptions for independent businesses.",
      createdAt: ago(15000),
    },
    {
      id: "formkit",
      name: "Formkit",
      url: "https://formkit.example.com",
      repository: "acme/formkit",
      description: "Simple forms. Reliable submissions.",
      createdAt: ago(12000),
    },
    {
      id: "docs",
      name: "Acme Docs",
      url: "https://docs.example.com",
      repository: "acme/docs",
      description: "The public documentation site.",
      createdAt: ago(9000),
    },
  ];
  const journeys = [
    {
      id: "checkout",
      projectId: "ledger",
      name: "Complete a checkout",
      path: "/checkout",
      condition: "The page displays “Thank you for your purchase”.",
      createdAt: ago(14000),
    },
    {
      id: "signin",
      projectId: "ledger",
      name: "Sign in to an account",
      path: "/login",
      condition: "The account dashboard is visible after signing in.",
      createdAt: ago(14000),
    },
    {
      id: "pricing",
      projectId: "ledger",
      name: "Explore pricing plans",
      path: "/pricing",
      condition: "All three pricing plans are visible.",
      createdAt: ago(14000),
    },
    {
      id: "contact",
      projectId: "formkit",
      name: "Submit a contact form",
      path: "/contact",
      condition: "A submission confirmation is displayed.",
      createdAt: ago(11000),
    },
    {
      id: "validation",
      projectId: "formkit",
      name: "Validate required fields",
      path: "/contact",
      condition: "Submitting an empty form shows required-field messages.",
      createdAt: ago(11000),
    },
    {
      id: "search",
      projectId: "docs",
      name: "Find a documentation page",
      path: "/",
      condition: "Searching for installation returns the installation guide.",
      createdAt: ago(8000),
    },
    {
      id: "quickstart",
      projectId: "docs",
      name: "Open the quickstart guide",
      path: "/quickstart",
      condition: "The quickstart page and code examples are visible.",
      createdAt: ago(8000),
    },
  ];
  const passedSteps = [
    {
      name: "Open the start page",
      detail: "Page loaded and document is ready.",
      status: "passed" as const,
      duration: 1240,
    },
    {
      name: "Locate the primary content",
      detail: "The expected content is visible.",
      status: "passed" as const,
      duration: 380,
    },
    {
      name: "Complete the interaction",
      detail: "The interaction completed.",
      status: "passed" as const,
      duration: 890,
    },
    {
      name: "Check the success condition",
      detail: "The expected confirmation is visible.",
      status: "passed" as const,
      duration: 260,
    },
  ];
  const runs: Run[] = journeys.map((j, i) => ({
    id: `run-${1038 - i}`,
    number: 1038 - i,
    projectId: j.projectId,
    journeyId: j.id,
    journeyName: j.name,
    status: "passed",
    startedAt: ago(12 + i * 9),
    duration: 8100 + i * 1260,
    branch: "main",
    commit: i < 3 ? "a8f3c21" : i < 5 ? "d61b9e4" : "b4e29a0",
    commitMessage:
      i < 3
        ? "Refine checkout confirmation"
        : i < 5
          ? "Update form validation messages"
          : "Add deployment guide",
    environment: "Preview",
    browser: "Chromium 130 · 1440 × 900",
    steps: passedSteps,
    logs: [
      "[00:00.000] Starting journey in Chromium",
      "[00:01.240] Navigation complete",
      "[00:02.510] Success condition matched",
      "[00:02.770] Journey finished",
    ],
  }));
  runs[0] = {
    ...runs[0],
    status: "failed",
    duration: 14320,
    steps: [
      {
        name: "Open checkout",
        detail: "GET /checkout · 200 OK",
        status: "passed",
        duration: 1240,
      },
      {
        name: "Enter billing details",
        detail: "Email and billing fields filled with fixture data.",
        status: "passed",
        duration: 1680,
      },
      {
        name: "Submit payment",
        detail: "Clicked the “Pay $29.00” button.",
        status: "passed",
        duration: 6400,
      },
      {
        name: "Verify order confirmation",
        detail: "Confirmation heading was not visible after 5,000ms.",
        status: "failed",
        duration: 5000,
      },
      {
        name: "Open order receipt",
        detail: "Not executed because the previous step failed.",
        status: "skipped",
        duration: null,
      },
    ],
    assertion: {
      expected: "Thank you for your purchase",
      received: "Payment could not be processed",
      locator: 'getByRole("heading", { name: "Thank you for your purchase" })',
      timeout: 5000,
    },
    screenshot: "/demo/checkout-evidence.svg",
    logs: [
      "[00:00.000] Starting journey in Chromium",
      "[00:01.240] GET /checkout → 200",
      "[00:02.920] Billing details entered",
      '[00:02.921] click: getByRole("button", { name: "Pay $29.00" })',
      "[00:09.320] POST /api/checkout → 422",
      '[00:09.320] Response: { "code": "payment_declined" }',
      "[00:14.320] Assertion failed: confirmation heading not visible",
      "[00:14.320] Screenshot fixture attached; remaining step skipped",
    ],
  };
  runs.push({
    ...runs[0],
    id: "run-1031",
    number: 1031,
    status: "passed",
    startedAt: ago(160),
    duration: 9240,
    steps: passedSteps,
    assertion: undefined,
    screenshot: undefined,
    commit: "f7d2a19",
    commitMessage: "Adjust checkout spacing",
    logs: [
      "[00:00.000] Starting journey",
      "[00:09.240] Success condition matched",
    ],
  });
  runs.push({
    ...runs[5],
    id: "run-1030",
    number: 1030,
    status: "running",
    startedAt: ago(180),
    duration: null,
    steps: [
      passedSteps[0],
      {
        name: "Search documentation",
        detail:
          "Waiting for the results list. This is a static running-state fixture.",
        status: "running",
        duration: null,
      },
    ],
    logs: [
      "[00:00.000] Demo running-state fixture",
      "[00:01.240] Waiting for search results",
    ],
  });
  runs.push({
    ...runs[4],
    id: "run-1029",
    number: 1029,
    status: "unknown",
    startedAt: ago(240),
    duration: null,
    steps: [],
    logs: [
      "[00:00.000] Demo fixture: execution metadata unavailable",
      "No result was recorded.",
    ],
  });
  return { projects, journeys, runs };
}

export function initialStorage(): Storage {
  return {
    version: 1,
    mode: process.env.NEXT_PUBLIC_DEMO_MODE === "false" ? "local" : "demo",
    demo: createDemo(),
    local: emptyWorkspace(),
  };
}
