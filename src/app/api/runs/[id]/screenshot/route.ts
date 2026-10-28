import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { apiError } from "@/lib/server/http";
import { artifactDownload } from "@/lib/server/execution-read";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const url = await artifactDownload(
      await requireWorkspace(),
      z
        .string()
        .uuid()
        .parse((await params).id),
    );
    return new Response(null, {
      status: 303,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
