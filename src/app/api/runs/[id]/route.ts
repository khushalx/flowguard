import { monitored } from "@/lib/server/monitoring";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { readRun } from "@/lib/server/workspace";
import { apiError } from "@/lib/server/http";
import { readExecution } from "@/lib/server/execution-read";
async function GETHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const context = await requireWorkspace();
    let run = await readRun(context, id);
    if (run.batchId && ["queued", "running"].includes(run.status)) {
      const execution = await readExecution(context, run.batchId);
      run = execution.runs.find((item) => item.id === id) ?? run;
    }
    return Response.json(run, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export const GET = monitored(GETHandler);
