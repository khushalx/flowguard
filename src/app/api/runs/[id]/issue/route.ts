import { monitored } from "@/lib/server/monitoring";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { issueAccess } from "@/lib/server/issues";
import { apiError, jsonBody, sameOrigin } from "@/lib/server/http";
async function POSTHandler(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const { action, reviewedHash } = z
      .object({
        action: z.enum(["check", "create"]),
        reviewedHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .parse(await jsonBody(request));
    return Response.json(
      await issueAccess(
        await requireWorkspace(true),
        id,
        action === "create",
        reviewedHash,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export const POST = monitored(POSTHandler);
