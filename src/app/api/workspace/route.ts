import { apiError, jsonBody, sameOrigin } from "@/lib/server/http";
import { requireWorkspace } from "@/lib/server/auth";
import { mutateWorkspace, readWorkspace } from "@/lib/server/workspace";
import { operationHeaders } from "@/lib/server/transport";
export async function GET() {
  const started = performance.now();
  try {
    return Response.json(await readWorkspace(await requireWorkspace()), {
      headers: operationHeaders("workspace_read", started),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
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
