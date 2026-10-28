import { apiError, jsonBody } from "@/lib/server/http";
import { claimExecution, runnerAuthorization } from "@/lib/server/execution";
export async function POST(request: Request) {
  try {
    const hash = await runnerAuthorization(request, "run");
    return Response.json(await claimExecution(hash, await jsonBody(request)), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
