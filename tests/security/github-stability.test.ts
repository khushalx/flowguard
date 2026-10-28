import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { Octokit } from "octokit";
import {
  findPersonalInstallation,
  githubFailure,
  githubConfigurationIssue,
} from "../../src/lib/server/github-client";

function client(handler: (url: URL) => Response) {
  return new Octokit({
    retry: { enabled: false },
    throttle: { enabled: false },
    request: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const result = handler(new URL(request.url));
        Object.defineProperty(result, "url", { value: request.url });
        return result;
      },
    },
  });
}
test("existing installation lookup resolves immutable identity even after a username change", async () => {
  const calls: string[] = [];
  const api = client((url) => {
    calls.push(url.pathname);
    return Response.json(
      url.pathname === "/user/1001"
        ? { id: 1001, type: "User", login: "renamed-alice" }
        : { id: 123, account: { id: 1001, type: "User" } },
    );
  });
  assert.equal((await findPersonalInstallation(api, 1001, api))?.id, 123);
  assert.deepEqual(calls, ["/user/1001", "/users/renamed-alice/installation"]);
});
test("no installation is distinct from GitHub failure and never fabricates a connection", async () => {
  const publicApi = client(() =>
    Response.json({ id: 1001, type: "User", login: "alice" }),
  );
  assert.equal(
    await findPersonalInstallation(
      client(() => Response.json({ message: "Not Found" }, { status: 404 })),
      1001,
      publicApi,
    ),
    null,
  );
  await assert.rejects(
    findPersonalInstallation(
      client(() => Response.json({ message: "Unavailable" }, { status: 503 })),
      1001,
      publicApi,
    ),
  );
});
test("discovery rejects spoofed and organization identities before looking up installations", async () => {
  let lookedUp = false;
  const app = client(() => {
    lookedUp = true;
    return Response.json({ id: 123 });
  });
  for (const account of [
    { id: 999, type: "User", login: "alice" },
    { id: 1001, type: "Organization", login: "org" },
  ])
    await assert.rejects(
      findPersonalInstallation(
        app,
        1001,
        client(() => Response.json(account)),
      ),
      /personal GitHub account/,
    );
  assert.equal(lookedUp, false);
});
test("rate limits remain retryable sync failures, distinct from revocation", () => {
  for (const error of [
    { status: 429 },
    { status: 403, response: { headers: { "x-ratelimit-remaining": "0" } } },
    { status: 403, response: { headers: { "retry-after": "60" } } },
  ]) {
    assert.equal(githubFailure(error).state, "sync_failed");
    assert.match(githubFailure(error).message, /rate limiting/);
  }
  assert.equal(githubFailure({ status: 403 }).state, "access_required");
  assert.equal(githubFailure({ status: 404 }).state, "removed");
  assert.equal(
    githubFailure(new Error("network unavailable")).state,
    "sync_failed",
  );
});
test("GitHub configuration validates real PEM keys and never includes credential values in diagnostics", () => {
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
  const env = {
    GITHUB_APP_ID: "123",
    GITHUB_APP_SLUG: "test-app",
    GITHUB_APP_PRIVATE_KEY: pem,
    SUPABASE_SECRET_KEY: "fixture-secret-never-an-actual-key",
  };
  assert.equal(githubConfigurationIssue(env), null);
  assert.equal(
    githubConfigurationIssue({
      ...env,
      GITHUB_APP_PRIVATE_KEY: pem.replaceAll("\n", "\\n"),
    }),
    null,
  );
  const message = githubConfigurationIssue({
    ...env,
    GITHUB_APP_PRIVATE_KEY: "invalid-sensitive-value",
  });
  assert.match(message!, /GITHUB_APP_PRIVATE_KEY/);
  assert.ok(!message!.includes("invalid-sensitive-value"));
  assert.match(
    githubConfigurationIssue({ ...env, SUPABASE_SECRET_KEY: "" })!,
    /SUPABASE_SECRET_KEY/,
  );
});
