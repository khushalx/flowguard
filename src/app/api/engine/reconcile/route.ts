import { timingSafeEqual } from "node:crypto";
import { apiError, AppError } from "@/lib/server/http";
import { reconcileAndRetain } from "@/lib/server/execution-read";
export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET;
    const actual = request.headers.get("authorization");
    if (
      !expected ||
      !actual ||
      Buffer.byteLength(actual) !== Buffer.byteLength(`Bearer ${expected}`) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(`Bearer ${expected}`))
    )
      throw new AppError("Schedule authentication required.", 401);
    return Response.json(await reconcileAndRetain(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
