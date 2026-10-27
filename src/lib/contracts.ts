import { z } from "zod";
import { journeySchema, projectSchema, validTarget } from "./model";

export const targetSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(
    validTarget,
    "Use a complete HTTP(S) URL with a valid hostname and no credentials.",
  );
export const projectInput = z.object({
  name: z.string().trim().min(1, "Enter a project name.").max(80),
  url: targetSchema,
  description: z.string().trim().max(240).default(""),
  repositoryId: z.string().uuid().nullable().default(null),
});
export const journeyInput = journeySchema
  .omit({ id: true, createdAt: true })
  .extend({ projectId: z.string().uuid() });
export const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createProject"), input: projectInput }),
  z.object({
    action: z.literal("updateProject"),
    id: z.string().uuid(),
    input: projectInput,
  }),
  z.object({ action: z.literal("deleteProject"), id: z.string().uuid() }),
  z.object({
    action: z.literal("saveJourney"),
    id: z.string().uuid().optional(),
    input: journeyInput,
  }),
  z.object({ action: z.literal("deleteJourney"), id: z.string().uuid() }),
  z.object({
    action: z.literal("importLocal"),
    projects: z.array(projectSchema).max(50),
    journeys: z.array(journeySchema).max(250),
  }),
]);
export type Repository = {
  id: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  status: ConnectionStatus;
};
export type ConnectionStatus =
  "connected" | "removed" | "access_required" | "sync_failed";
export type Installation = {
  id: string;
  account: string;
  status: ConnectionStatus;
  needsSync: boolean;
};
export type Account = {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  avatar: string | null;
};
export type WorkspaceInfo = {
  id: string;
  name: string;
  role: string;
  account: Account;
};
