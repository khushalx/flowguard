import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { apiError, sameOrigin } from "@/lib/server/http";
import { readExecution, cancelExecution } from "@/lib/server/execution-read";
type Params = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Params) {
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
export async function POST(request: Request, { params }: Params) {
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
