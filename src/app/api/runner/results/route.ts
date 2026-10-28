import { apiError, jsonBody } from "@/lib/server/http";
import { completeExecution, runnerAuthorization } from "@/lib/server/execution";
export async function POST(request: Request) {
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
