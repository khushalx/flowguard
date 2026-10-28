import { monitored } from "@/lib/server/monitoring";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { apiError, dbCheck, jsonBody, sameOrigin } from "@/lib/server/http";
async function GETHandler() {
  try {
    const c = await requireWorkspace();
    const [prefs, events] = await Promise.all([
      c.db
        .from("notification_preferences")
        .select("in_app")
        .eq("workspace_id", c.workspaceId)
        .eq("user_id", c.user.id)
        .maybeSingle(),
      c.db
        .from("workspace_events")
        .select("id,run_id,kind,created_at")
        .eq("workspace_id", c.workspaceId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    dbCheck(prefs.error);
    dbCheck(events.error);
    return Response.json(
      {
        inApp: prefs.data?.in_app ?? true,
        events: prefs.data?.in_app === false ? [] : events.data,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
async function POSTHandler(request: Request) {
  try {
    sameOrigin(request);
    const c = await requireWorkspace();
    const value = z
      .object({ inApp: z.boolean() })
      .strict()
      .parse(await jsonBody(request));
    const result = await c.db.from("notification_preferences").upsert(
      {
        workspace_id: c.workspaceId,
        user_id: c.user.id,
        in_app: value.inApp,
      },
      { onConflict: "workspace_id,user_id" },
    );
    dbCheck(result.error);
    return Response.json(
      { saved: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export const GET = monitored(GETHandler);
export const POST = monitored(POSTHandler);
