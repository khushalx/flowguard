import { monitored } from "@/lib/server/monitoring";
import { apiError, jsonBody, sameOrigin } from "@/lib/server/http";
import { requireWorkspace } from "@/lib/server/auth";
import { mutateWorkspace, readWorkspace } from "@/lib/server/workspace";
import { operationHeaders } from "@/lib/server/transport";
async function GETHandler() {
  const started = performance.now();
  try {
    return Response.json(await readWorkspace(await requireWorkspace()), {
      headers: operationHeaders("workspace_read", started),
    });
  } catch (error) {
    return apiError(error);
  }
}
async function POSTHandler(request: Request) {
  const started = performance.now();
  try {
    sameOrigin(request);
    const input = await jsonBody(request);
    return Response.json(
      await mutateWorkspace(input, await requireWorkspace(true)),
      { headers: operationHeaders("workspace_save", started) },
    );
  } catch (error) {
    return apiError(error);
  }
}

export const GET = monitored(GETHandler);
export const POST = monitored(POSTHandler);
