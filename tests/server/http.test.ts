import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError, jsonBody } from "../../src/lib/server/http";

test("JSON request limits count streamed UTF-8 bytes before collecting the full body", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("€".repeat(70_000)));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://flowguard.example/api/runner/results", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(
    jsonBody(request),
    (error: unknown) => error instanceof AppError && error.status === 413,
  );
  assert.equal(cancelled, true);
});
test("JSON decoding preserves valid Unicode and rejects non-JSON input", async () => {
  const request = (body: string) =>
    new Request("https://flowguard.example/api/runner/results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  assert.deepEqual(await jsonBody(request('{"name":"部署"}')), {
    name: "部署",
  });
  await assert.rejects(jsonBody(request("{")), /Invalid JSON/);
});
