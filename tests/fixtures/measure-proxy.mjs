// Local test measurement proxy. Records paths and durations only, never credentials.
import { createServer } from "node:http";
let metrics = [];
createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:4546");
  if (url.pathname === "/measure/reset") {
    metrics = [];
    res.end("{}");
    return;
  }
  if (url.pathname === "/measure/results") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(metrics));
    return;
  }
  try {
    const start = performance.now();
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await fetch("http://127.0.0.1:4545" + req.url, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(
          ([k]) =>
            ![
              "host",
              "connection",
              "content-length",
              "accept-encoding",
            ].includes(k),
        ),
      ),
      body: ["GET", "HEAD"].includes(req.method)
        ? undefined
        : Buffer.concat(chunks),
      redirect: "manual",
    });
    metrics.push({
      path: url.pathname,
      method: req.method,
      status: response.status,
      ms: Math.round(performance.now() - start),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(502);
    res.end("{}");
  }
}).listen(4546, "127.0.0.1");
