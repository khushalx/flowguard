import { monitored } from "@/lib/server/monitoring";
import { apiError, jsonBody } from "@/lib/server/http";
import { completeExecution, runnerAuthorization } from "@/lib/server/execution";
async function POSTHandler(request: Request) {
  try {
    const hash = await runnerAuthorization(request, "exec");
    return Response.json(
      await completeExecution(hash, await jsonBody(request)),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export const POST = monitored(POSTHandler);
