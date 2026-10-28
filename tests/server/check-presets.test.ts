import { test } from "node:test";
import assert from "node:assert/strict";
import { pageCheck } from "../../src/lib/check-presets";
import {
  runnerInstallation,
  RUNNER_REVISION,
} from "../../src/lib/server/runner-installation";
import { journeyDefinitionSchema } from "../../packages/runner/src/schema";

test("a starter check contains a real positive assertion and refuses foreign or unsafe pages", () => {
  const check = pageCheck("https://example.com", "/pricing");
  assert.equal(
    journeyDefinitionSchema.safeParse(check.definition).success,
    true,
  );
  assert.equal(check.definition.steps[0].action, "assertVisible");
  assert.equal(check.definition.captureArtifacts, false);
  assert.equal(
    pageCheck("https://example.com", "/", "Welcome").name,
    "Page shows Welcome",
  );
  for (const path of [
    "https://evil.example/",
    "//evil.example/",
    "javascript:alert(1)",
    "/\\evil.example/",
  ])
    assert.throws(() => pageCheck("https://example.com", path));
});
test("prepared installation removes customer variables, pins reviewed source and never embeds a credential", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://flowguard.example.com";
  const install = await runnerInstallation({
    full_name: "owner/site",
    default_branch: "release/site",
  });
  const editor = new URL(install.workflowUrl);
  assert.equal(editor.origin, "https://github.com");
  assert.equal(editor.pathname, "/owner/site/new/release%2Fsite");
  assert.equal(
    editor.searchParams.get("filename"),
    ".github/workflows/flowguard.yml",
  );
  assert.equal(editor.searchParams.get("value"), install.workflow);
  assert.ok(install.workflow.includes(RUNNER_REVISION));
  assert.ok(!install.workflow.includes("vars.FLOWGUARD_"));
  assert.ok(install.workflow.includes("secrets.FLOWGUARD_RUNNER_TOKEN"));
  assert.ok(!install.workflow.includes("fg_run_"));
  assert.ok(install.workflow.includes("persist-credentials: false"));
});
