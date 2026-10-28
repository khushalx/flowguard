import { monitored } from "@/lib/server/monitoring";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { apiError, jsonBody, sameOrigin } from "@/lib/server/http";
import {
  executionSetup,
  queueExecution,
  runnerCredential,
} from "@/lib/server/execution";
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("run"),
      projectId: z.string().uuid(),
      requestId: z.string().uuid(),
      journeyIds: z.array(z.string().uuid()).min(1).max(5).optional(),
      verificationOf: z.string().uuid().optional(),
      targetUrl: z.string().url().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.enum(["rotate", "revoke"]),
      projectId: z.string().uuid(),
    })
    .strict(),
]);
async function GETHandler(request: Request) {
  try {
    const id = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("projectId"));
    return Response.json(
      await executionSetup(await requireWorkspace(true), id),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
async function POSTHandler(request: Request) {
  try {
    sameOrigin(request);
    const context = await requireWorkspace(true);
    const value = input.parse(await jsonBody(request));
    const result =
      value.action === "run"
        ? await queueExecution(context, value)
        : await runnerCredential(context, value.projectId, value.action);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export const GET = monitored(GETHandler);
export const POST = monitored(POSTHandler);
