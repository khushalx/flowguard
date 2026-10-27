import { apiError, jsonBody, sameOrigin } from "@/lib/server/http";
import { requireWorkspace } from "@/lib/server/auth";
import { mutateWorkspace, readWorkspace } from "@/lib/server/workspace";
export async function GET() {
  try {
    return Response.json(await readWorkspace(await requireWorkspace()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = await jsonBody(request);
    return Response.json(
      await mutateWorkspace(input, await requireWorkspace(true)),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
