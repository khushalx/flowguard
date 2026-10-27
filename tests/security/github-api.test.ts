import { test } from "node:test";
import assert from "node:assert/strict";
import { Octokit } from "octokit";
import { fetchInstallationRepositories } from "../../src/lib/server/github-repositories";

test("Octokit repository listing requests metadata-only tokens, follows pagination and returns no credentials", async () => {
  const calls: { url: string; body: unknown; authorization: string | null }[] =
    [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const respond = (data: unknown, options?: ResponseInit) => {
      const response = Response.json(data, options);
      Object.defineProperty(response, "url", { value: request.url });
      return response;
    };
    calls.push({
      url: request.url,
      body: text ? JSON.parse(text) : null,
      authorization: request.headers.get("authorization"),
    });
    if (url.pathname === "/app/installations/123/access_tokens")
      return respond({
        token: "fixture-installation-token",
        expires_at: "2026-10-28T00:00:00Z",
      });
    const second = url.searchParams.get("page") === "2";
    return respond(
      {
        total_count: 2,
        repositories: [
          {
            id: second ? 2 : 1,
            owner: { login: "alice" },
            name: second ? "two" : "one",
            full_name: second ? "alice/two" : "alice/one",
            default_branch: "main",
            private: true,
            html_url: "https://github.com/alice/" + (second ? "two" : "one"),
          },
        ],
      },
      {
        headers: second
          ? {}
          : {
              Link: '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"',
            },
      },
    );
  };
  const app = new Octokit({
    auth: "fixture-app-jwt",
    request: { fetch: transport },
  });
  const result = await fetchInstallationRepositories(app, 123, transport);
  assert.deepEqual(calls[0].body, { permissions: { metadata: "read" } });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].authorization, "token fixture-installation-token");
  assert.deepEqual(
    result.map((r) => r.fullName),
    ["alice/one", "alice/two"],
  );
  assert.equal(JSON.stringify(result).includes("token"), false);
});
