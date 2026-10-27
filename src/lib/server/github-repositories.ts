import { Octokit } from "octokit";

// The optional transport is a test seam, never populated from request input.
export async function fetchInstallationRepositories(
  app: Pick<Octokit, "request">,
  installationId: number,
  transport?: typeof fetch,
) {
  const { data: grant } = await app.request(
    "POST /app/installations/{installation_id}/access_tokens",
    { installation_id: installationId, permissions: { metadata: "read" } },
  );
  const client = new Octokit({
    auth: grant.token,
    request: transport ? { fetch: transport } : undefined,
  });
  const repos = await client.paginate("GET /installation/repositories", {
    per_page: 100,
  });
  return repos.map((r) => ({
    id: String(r.id),
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    private: r.private,
    htmlUrl: r.html_url,
  }));
}
