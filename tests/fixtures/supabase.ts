// Local integration fixture only. Not imported by application source.
// Auth is mocked, while all database CRUD/RLS uses the actual migration in PG.
import { createServer } from "node:http";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const db = new PGlite();
const uid = "00000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  aud: "authenticated",
  role: "authenticated",
  email: "alice@example.com",
  email_confirmed_at: "2026-10-01T00:00:00Z",
  app_metadata: { provider: "github", providers: ["github"] },
  user_metadata: { user_name: "editable-not-authorized", provider_id: "99999" },
  created_at: "2026-10-01T00:00:00Z",
  identities: [
    {
      id: "1001",
      user_id: uid,
      provider: "github",
      identity_id: "11111111-1111-4111-8111-111111111111",
      identity_data: { sub: "1001" },
    },
  ],
};
const encode = (x: unknown) =>
  Buffer.from(JSON.stringify(x)).toString("base64url");
const tokenBody = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: uid, aud: "authenticated", role: "authenticated", email: user.email, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`;
const accessToken =
  tokenBody +
  "." +
  createHmac("sha256", "mock-only-never-used-in-application")
    .update(tokenBody)
    .digest("base64url");
const session = () => ({
  access_token: accessToken,
  refresh_token: "local-fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
});
const codes = new Map<string, string>();
let revoked = false;

async function main() {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table auth.identities(user_id uuid references auth.users,provider text,provider_id text,identity_data jsonb);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;insert into auth.users values('${uid}');insert into auth.identities values('${uid}','github','1001','{"user_name":"alice","full_name":"Alice Developer"}');`,
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/" +
        readdirSync("supabase/migrations").find((f) =>
          f.endsWith("_phase_two_foundation.sql"),
        ),
      "utf8",
    ),
  );

  async function queryRest(
    tx: Transaction,
    table: string,
    url: URL,
    method: string,
    body: Record<string, unknown>,
  ) {
    const allowed = [
      "projects",
      "journeys",
      "runs",
      "repositories",
      "github_installations",
      "profiles",
      "workspaces",
      "workspace_members",
    ];
    if (!allowed.includes(table)) throw new Error("Unsupported fixture table");
    const values: unknown[] = [];
    const filters: string[] = [];
    for (const [key, value] of url.searchParams) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      if (key === "projects.workspace_id") {
        values.push(value.replace(/^eq\./, ""));
        filters.push(
          `project_id in (select id from public.projects where workspace_id=$${values.length})`,
        );
        continue;
      }
      if (!/^[a-z_]+$/.test(key) || !value.startsWith("eq."))
        throw new Error("Unsupported fixture filter");
      values.push(value.slice(3));
      filters.push(`"${key}"=$${values.length}`);
    }
    const where = filters.length ? " where " + filters.join(" and ") : "";
    let rows;
    if (method === "GET")
      rows = (await tx.query(`select * from public.${table}${where}`, values))
        .rows;
    else if (method === "DELETE")
      rows = (
        await tx.query(
          `delete from public.${table}${where} returning *`,
          values,
        )
      ).rows;
    else {
      const keys = Object.keys(body);
      if (!keys.every((k) => /^[a-z_]+$/.test(k)))
        throw new Error("Invalid fixture fields");
      if (method === "POST")
        rows = (
          await tx.query(
            `insert into public.${table}(${keys.map((k) => `"${k}"`).join(",")}) values(${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning *`,
            Object.values(body),
          )
        ).rows;
      else {
        const setters = keys.map((k) => {
          values.push(body[k]);
          return `"${k}"=$${values.length}`;
        });
        rows = (
          await tx.query(
            `update public.${table} set ${setters.join(",")}${where} returning *`,
            values,
          )
        ).rows;
      }
    }
    // PostgREST serializes timestamptz with offsets; test the UI's real shape.
    return rows.map((row) => {
      const r = { ...(row as Record<string, unknown>) } as Record<
        string,
        unknown
      >;
      for (const key in r) {
        if (r[key] instanceof Date)
          r[key] = (r[key] as Date).toISOString().replace("Z", "+00:00");
      }
      if (table === "journeys") r.projects = { workspace_id: uid };
      if (table === "runs") r.run_steps = [];
      return r;
    });
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1:4545");
    const send = (status: number, data: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    try {
      if (url.pathname === "/health") return send(200, { ok: true });
      if (url.pathname === "/test/revoke") {
        revoked = true;
        return send(200, { ok: true });
      }
      if (url.pathname === "/test/reset") {
        await db.exec(
          "delete from public.workspaces; delete from public.profiles;",
        );
        revoked = false;
        return send(200, { ok: true });
      }
      if (url.pathname === "/auth/v1/authorize") {
        revoked = false;
        const code = randomBytes(16).toString("hex");
        codes.set(code, url.searchParams.get("code_challenge")!);
        const target = new URL(url.searchParams.get("redirect_to")!);
        target.searchParams.set("code", code);
        res.writeHead(302, { Location: target.toString() });
        return res.end();
      }
      let raw = "";
      for await (const part of req) raw += part;
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === "/auth/v1/token") {
        if (url.searchParams.get("grant_type") === "pkce") {
          const challenge = codes.get(body.auth_code);
          codes.delete(body.auth_code);
          if (
            !challenge ||
            createHash("sha256")
              .update(body.code_verifier ?? "")
              .digest("base64url") !== challenge
          )
            return send(400, {
              error: "invalid_grant",
              error_description: "Invalid PKCE verifier",
            });
        } else if (revoked) return send(401, { msg: "Session expired" });
        return send(200, session());
      }
      if (req.headers.authorization !== `Bearer ${accessToken}` || revoked)
        return send(401, { code: "bad_jwt", msg: "Invalid session" });
      if (url.pathname === "/auth/v1/user") return send(200, user);
      if (url.pathname === "/auth/v1/logout") {
        revoked = true;
        return send(200, {});
      }
      if (!url.pathname.startsWith("/rest/v1/")) return send(404, {});
      const rows = await db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
          uid,
        ]);
        if (url.pathname === "/rest/v1/rpc/bootstrap_workspace")
          return (
            await tx.query<{ id: string }>(
              "select public.bootstrap_workspace() as id",
            )
          ).rows[0].id;
        if (url.pathname === "/rest/v1/rpc/import_local_workspace") {
          await tx.query(
            "select public.import_local_workspace($1::jsonb,$2::jsonb)",
            [JSON.stringify(body.projects), JSON.stringify(body.journeys)],
          );
          return null;
        }
        return queryRest(
          tx,
          url.pathname.slice("/rest/v1/".length),
          url,
          req.method!,
          body,
        );
      });
      if (req.headers.accept?.includes("vnd.pgrst.object+json")) {
        if (!Array.isArray(rows) || rows.length !== 1)
          return send(406, { code: "PGRST116", message: "Expected one row" });
        return send(200, rows[0]);
      }
      send(200, rows);
    } catch (error) {
      const e = error as { code?: string; message: string };
      send(400, { code: e.code ?? "fixture_error", message: e.message });
    }
  });
  server.listen(4545, "127.0.0.1");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
