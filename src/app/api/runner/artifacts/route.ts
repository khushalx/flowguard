import { z } from "zod";
import { apiError, jsonBody, dbCheck, AppError } from "@/lib/server/http";
import { engineOperation, runnerAuthorization } from "@/lib/server/execution";
import { adminClient } from "@/lib/supabase/admin";
export async function POST(request: Request) {
  try {
    const hash = await runnerAuthorization(request, "exec");
    const input = z
      .object({
        action: z.enum(["prepare", "confirm"]),
        batchId: z.string().uuid(),
        runId: z.string().uuid(),
        bytes: z.number().int().min(1).max(2097152),
      })
      .strict()
      .parse(await jsonBody(request));
    const object = await engineOperation("artifact", {
      batch_id: input.batchId,
      run_id: input.runId,
      token_verifier: hash,
      bytes: input.bytes,
    });
    if (input.action === "confirm") {
      const info = await adminClient()
        .storage.from("flowguard-evidence")
        .info(object.path);
      dbCheck(info.error);
      if (
        !info.data ||
        info.data.size !== input.bytes ||
        info.data.contentType !== "image/png"
      )
        throw new AppError("Uploaded screenshot metadata did not match.", 400);
      await engineOperation("artifact_confirm", {
        batch_id: input.batchId,
        run_id: input.runId,
        token_verifier: hash,
        bytes: input.bytes,
      });
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const upload = await adminClient()
      .storage.from("flowguard-evidence")
      .createSignedUploadUrl(object.path, { upsert: false });
    dbCheck(upload.error);
    return Response.json(
      { url: upload.data!.signedUrl },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
