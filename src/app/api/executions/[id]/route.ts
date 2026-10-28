import { monitored } from "@/lib/server/monitoring";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { apiError, sameOrigin } from "@/lib/server/http";
import { readExecution, cancelExecution } from "@/lib/server/execution-read";
type Params = { params: Promise<{ id: string }> };
async function GETHandler(_request: Request, { params }: Params) {
  try {
    return Response.json(
      await readExecution(
        await requireWorkspace(),
        z
          .string()
          .uuid()
          .parse((await params).id),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
async function POSTHandler(request: Request, { params }: Params) {
  try {
    sameOrigin(request);
    return Response.json(
      await cancelExecution(
        await requireWorkspace(true),
        z
          .string()
          .uuid()
          .parse((await params).id),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export const GET = monitored(GETHandler);
export const POST = monitored(POSTHandler);
