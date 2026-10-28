import { monitored } from "@/lib/server/monitoring";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { readRunPage } from "@/lib/server/workspace";
import { apiError } from "@/lib/server/http";
async function GETHandler(request: Request) {
  try {
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .parse(new URL(request.url).searchParams.get("offset") ?? 0);
    return Response.json(await readRunPage(await requireWorkspace(), offset), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export const GET = monitored(GETHandler);
