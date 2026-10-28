// Never log URLs, query strings, request bodies, headers, cookies or responses.
// Safe operation names and durations make cross-region latency diagnosable.
export function backendFetch(service: "supabase" | "github"): typeof fetch {
  return async (input, init) => {
    const start = performance.now();
    const timeout = AbortSignal.timeout(8_000);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    let status = 0;
    try {
      const response = await fetch(input, { ...init, signal });
      status = response.status;
      return response;
    } finally {
      const durationMs = Math.round(performance.now() - start);
      if (durationMs >= 300 || status >= 500 || status === 0)
        console.info("FlowGuard backend request", {
          service,
          status,
          durationMs,
        });
    }
  };
}
export function operationHeaders(operation: string, started: number) {
  const duration = Math.round(performance.now() - started);
  return {
    "Cache-Control": "private, no-store",
    "Server-Timing": `${operation};dur=${duration}`,
  };
}
