import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { safeReturnTo } from "../../src/lib/env";
import { validTarget } from "../../src/lib/model";
import {
  authorizedPersonalInstallation,
  hashState,
  sameSecret,
  validWebhook,
  webhookSchema,
} from "../../src/lib/server/github-security";
import { mutationSchema } from "../../src/lib/contracts";

test("return destinations accept only internal app routes", () => {
  for (const url of [
    "https://evil.test",
    "//evil.test",
    "/app\\evil",
    "/application",
    "/app/%5cevil",
    "/app/%0aLocation:evil",
    "javascript:alert(1)",
    "/demo",
    "/app/../../evil",
  ])
    assert.equal(safeReturnTo(url), "/app", url);
  assert.equal(
    safeReturnTo("/app/projects/new?from=login"),
    "/app/projects/new?from=login",
  );
});
test("target URL validation rejects unsafe schemes, credentials and malformed domains without fetching URLs", () => {
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "http://",
    "https://example.com\\foo",
    "http://badhost",
  ])
    assert.equal(validTarget(url), false, url);
  for (const url of [
    "https://example.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://app.example.com/preview",
  ])
    assert.equal(validTarget(url), true, url);
});
test("webhook signature validates the original bytes and rejects altered or malformed signatures", () => {
  const body = Buffer.from('{"message":"héllo"}');
  const secret = "local-test-secret";
  const signature =
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(validWebhook(body, signature, secret), true);
  assert.equal(validWebhook(Buffer.from(body + " "), signature, secret), false);
  for (const bad of [
    null,
    "",
    "sha1=abc",
    "sha256=aa",
    "sha256=" + "0".repeat(64),
  ])
    assert.equal(validWebhook(body, bad, secret), false);
});
test("mocked GitHub responses authorize only the verified personal owner", () => {
  assert.equal(
    authorizedPersonalInstallation(
      { account: { id: 1001, type: "User" } },
      1001,
    ),
    true,
  );
  assert.equal(
    authorizedPersonalInstallation(
      { account: { id: 1002, type: "User" } },
      1001,
    ),
    false,
  );
  assert.equal(
    authorizedPersonalInstallation(
      { account: { id: 1001, type: "Organization" } },
      1001,
    ),
    false,
  );
  assert.equal(
    authorizedPersonalInstallation(
      { account: { id: 1001, type: "User" }, suspended_at: "2026-01-01" },
      1001,
    ),
    false,
  );
  assert.equal(authorizedPersonalInstallation({ account: null }, 1001), false);
});
test("state hashes are deterministic but do not expose the raw cookie and payload IDs must be safe integers", () => {
  assert.equal(hashState("nonce"), hashState("nonce"));
  assert.notEqual(hashState("nonce"), "nonce");
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "ab"), false);
  assert.equal(
    webhookSchema.safeParse({ installation: { id: Infinity } }).success,
    false,
  );
});
test("server mutation validation rejects non-UUID repository claims and untrusted target schemes", () => {
  assert.equal(
    mutationSchema.safeParse({
      action: "createProject",
      input: { name: "App", url: "https://example.com", repositoryId: "123" },
    }).success,
    false,
  );
  assert.equal(
    mutationSchema.safeParse({
      action: "createProject",
      input: { name: "App", url: "file:///etc/passwd" },
    }).success,
    false,
  );
  const result = mutationSchema.parse({
    action: "createProject",
    input: { name: "App", url: "https://example.com", workspace_id: "other" },
  });
  assert.equal(
    result.action === "createProject" && "workspace_id" in result.input,
    false,
  );
});
