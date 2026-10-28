import { monitored } from "@/lib/server/monitoring";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { runReport } from "@/lib/server/reports";
import { apiError } from "@/lib/server/http";
import { operationHeaders } from "@/lib/server/transport";
async function GETHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const start = performance.now();
  try {
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const report = await runReport(await requireWorkspace(), id);
    const headers = operationHeaders("report", start);
    headers["Server-Timing"] +=
      `, evidence;dur=${report.timing.evidenceMs.toFixed(2)}, template;dur=${report.timing.templateMs.toFixed(2)}, comparison;dur=${report.timing.comparisonMs.toFixed(2)}`;
    return Response.json(report, { headers });
  } catch (error) {
    return apiError(error);
  }
}

export const GET = monitored(GETHandler);
