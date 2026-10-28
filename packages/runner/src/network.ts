import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolveDestination(host: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Target DNS lookup timed out")),
          3000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function approvedUrl(
  value: string,
  target: string,
  allowFixturePort = false,
) {
  if (/[\\\u0000-\u0020]/.test(value)) throw new Error("Unsafe navigation URL");
  const url = new URL(value, target);
  const origin = new URL(target);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.origin !== origin.origin ||
    (!allowFixturePort && !["", "80", "443"].includes(url.port))
  )
    throw new Error(
      "Navigation must stay on the approved project origin using port 80 or 443.",
    );
  return url.href;
}

// Browser traffic crosses this proxy. Resolve once per connection, validate ALL
// answers, and connect to the chosen IP rather than resolving the hostname again.
// Routing alone cannot defend against DNS rebinding or automatic redirects.
export async function safeProxy(
  target: string,
  allowPrivateForFixture = false,
) {
  const approved = new URL(approvedUrl(target, target, allowPrivateForFixture));
  const sockets = new Set<net.Socket>();
  async function destination(host: string, port: number) {
    if (
      host.toLowerCase() !==
        approved.hostname.replace(/^\[|\]$/g, "").toLowerCase() ||
      port !==
        Number(approved.port || (approved.protocol === "https:" ? 443 : 80))
    )
      throw new Error("Unapproved destination");
    const addresses = await resolveDestination(host);
    if (
      !addresses.length ||
      (!allowPrivateForFixture &&
        addresses.some((a) => !publicAddress(a.address)))
    )
      throw new Error("Private network blocked");
    return addresses[0];
  }
  await destination(
    approved.hostname.replace(/^\[|\]$/g, ""),
    Number(approved.port || (approved.protocol === "https:" ? 443 : 80)),
  );
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url!);
      approvedUrl(url.href, approved.href, allowPrivateForFixture);
      if (url.protocol !== "http:") throw new Error("Use CONNECT for TLS");
      const address = await destination(url.hostname, Number(url.port || 80));
      const headers: http.OutgoingHttpHeaders = {
        ...req.headers,
        host: url.host,
      };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = http.request(
        {
          hostname: address.address,
          family: address.family,
          port: Number(url.port || 80),
          path: url.pathname + url.search,
          method: req.method,
          headers,
          timeout: 15_000,
        },
        (response) => {
          res.writeHead(response.statusCode || 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    } catch {
      res.writeHead(403);
      res.end("Destination blocked by FlowGuard");
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("connect", async (req, socket, head) => {
    try {
      const url = new URL(`https://${req.url}`);
      const address = await destination(
        url.hostname.replace(/^\[|\]$/g, ""),
        Number(url.port || 443),
      );
      const upstream = net.connect({
        host: address.address,
        port: Number(url.port || 443),
        family: address.family,
      });
      sockets.add(upstream);
      upstream.once("close", () => sockets.delete(upstream));
      upstream.setTimeout(150_000, () => upstream.destroy());
      upstream.once("connect", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.once("close", () => upstream.destroy());
    } catch {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;
  return {
    server: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
