import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function hashState(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function sameSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validWebhook(
  body: Buffer,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  return sameSecret(
    signature,
    `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
  );
}
export function authorizedPersonalInstallation(
  installation: {
    account: unknown;
    suspended_at?: string | null;
  },
  githubId: number,
) {
  const account = z
    .object({
      id: z.coerce.number().int().positive().safe(),
      type: z.literal("User"),
    })
    .safeParse(installation.account);
  return (
    account.success &&
    account.data.id === githubId &&
    !installation.suspended_at
  );
}
const githubId = z.number().int().positive().safe();
export const webhookSchema = z.object({
  action: z.string().optional(),
  installation: z.object({ id: githubId }).optional(),
  repositories_removed: z
    .array(z.object({ id: githubId }))
    .max(10000)
    .optional(),
});
export const supportedEvents = new Set([
  "ping",
  "installation",
  "installation_repositories",
]);
export const installationActions = new Set([
  "created",
  "deleted",
  "suspend",
  "unsuspend",
  "new_permissions_accepted",
]);
