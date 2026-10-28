import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { readRun } from "@/lib/server/workspace";
import { apiError } from "@/lib/server/http";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    return Response.json(await readRun(await requireWorkspace(), id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
