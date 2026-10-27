import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import {
  validWebhook,
  supportedEvents,
  webhookSchema,
  installationActions,
} from "@/lib/server/github-security";
import { apiError, AppError, dbCheck } from "@/lib/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) throw new AppError("Webhook is not configured.", 503);
    if (Number(request.headers.get("content-length") ?? 0) > 2_000_000)
      throw new AppError("Payload too large.", 413);
    const body = Buffer.from(await request.arrayBuffer());
    if (body.length > 2_000_000) throw new AppError("Payload too large.", 413);
    if (!validWebhook(body, request.headers.get("x-hub-signature-256"), secret))
      throw new AppError("Invalid webhook signature.", 401);
    const event = request.headers.get("x-github-event") ?? "";
    if (!supportedEvents.has(event))
      return Response.json({ ignored: true }, { status: 202 });
    const delivery = z
      .string()
      .uuid()
      .parse(request.headers.get("x-github-delivery"));
    let json: unknown;
    try {
      json = JSON.parse(body.toString("utf8"));
    } catch {
      throw new AppError("Invalid payload.");
    }
    const parsed = webhookSchema.parse(json);
    if (event !== "ping" && !parsed.installation)
      throw new AppError("Installation ID required.");
    if (
      event === "installation" &&
      !installationActions.has(parsed.action ?? "")
    )
      return Response.json({ ignored: true }, { status: 202 });
    if (
      event === "installation_repositories" &&
      !["added", "removed"].includes(parsed.action ?? "")
    )
      return Response.json({ ignored: true }, { status: 202 });
    const result = await adminClient().rpc("apply_github_webhook", {
      delivery,
      event,
      payload: parsed,
    });
    dbCheck(result.error);
    console.info("GitHub webhook processed", {
      delivery,
      event,
      duplicate: result.data === false,
    });
    return Response.json({ received: true, duplicate: result.data === false });
  } catch (error) {
    return apiError(error);
  }
}
