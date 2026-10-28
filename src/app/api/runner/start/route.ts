import { monitored } from "@/lib/server/monitoring";
import { z } from "zod";
import { apiError, jsonBody } from "@/lib/server/http";
import { engineOperation, runnerAuthorization } from "@/lib/server/execution";
async function POSTHandler(request: Request) {
  try {
    const hash = await runnerAuthorization(request, "exec");
    const value = z
      .object({ batchId: z.string().uuid(), runId: z.string().uuid() })
      .strict()
      .parse(await jsonBody(request));
    return Response.json(
      await engineOperation("start", {
        batch_id: value.batchId,
        run_id: value.runId,
        token_verifier: hash,
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export const POST = monitored(POSTHandler);
