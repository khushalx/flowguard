import { monitored } from "@/lib/server/monitoring";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { analyzeFailure } from "@/lib/server/analysis";
import { apiError, jsonBody, sameOrigin } from "@/lib/server/http";
import { operationHeaders } from "@/lib/server/transport";
async function POSTHandler(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const start = performance.now();
  try {
    sameOrigin(request);
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const input = z
      .object({ reviewedHash: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(await jsonBody(request));
    return Response.json(
      await analyzeFailure(
        await requireWorkspace(true),
        id,
        input.reviewedHash,
      ),
      { headers: operationHeaders("analysis", start) },
    );
  } catch (error) {
    return apiError(error);
  }
}

export const POST = monitored(POSTHandler);
