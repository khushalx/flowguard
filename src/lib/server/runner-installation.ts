import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { appOrigin } from "../env";

// Published runner source, verified on GitHub before pinning. Update only after
// reviewing and publishing a compatible runner; never resolve a mutable branch.
export const RUNNER_REVISION = "e5d1a55e87e55cbcc32c86bb273657bcb3b7b943";
export async function runnerInstallation(repository: {
  full_name: string;
  default_branch: string;
}) {
  const source = await readFile(
    join(process.cwd(), "public/flowguard-workflow.yml"),
    "utf8",
  );
  const workflow = source
    .replaceAll(
      "${{ vars.FLOWGUARD_RUNNER_REV }}",
      JSON.stringify(RUNNER_REVISION),
    )
    .replaceAll("${{ vars.FLOWGUARD_URL }}", JSON.stringify(appOrigin()));
  const repo = repository.full_name
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const base = `https://github.com/${repo}`;
  const editor = new URL(
    `${base}/new/${encodeURIComponent(repository.default_branch)}`,
  );
  editor.searchParams.set("filename", ".github/workflows/flowguard.yml");
  editor.searchParams.set("value", workflow);
  return {
    workflow,
    workflowUrl: editor.href,
    secretsUrl: `${base}/settings/secrets/actions/new`,
    repository: repository.full_name,
    branch: repository.default_branch,
  };
}
