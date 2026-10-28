// Test process preload only. Application code has no test transport flag.
// Redirect GitHub REST requests to the local fixture; never contact GitHub.
const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname !== "api.github.com") return original(input, init);
  const target = new URL(
    `/github${url.pathname}${url.search}`,
    "http://127.0.0.1:4545",
  );
  return original(new Request(target, request));
};
