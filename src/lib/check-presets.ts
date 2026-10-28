import { journeyDefinitionSchema } from "../../packages/runner/src/schema";
import { validPath } from "./model";

export function pageCheck(target: string, path: string, expected = "") {
  const start = path.trim();
  if (
    !validPath(start) ||
    new URL(start, target).origin !== new URL(target).origin
  )
    throw new Error(
      "Choose a page on this project's website, such as /pricing.",
    );
  const text = expected.trim();
  return {
    name: text
      ? `Page shows ${text}`.slice(0, 100)
      : start === "/"
        ? "Homepage loads"
        : `${start} loads`.slice(0, 100),
    path: start,
    condition: text
      ? `The page displays “${text}”.`.slice(0, 500)
      : "The page responds successfully and its content is visible.",
    enabled: true,
    definition: journeyDefinitionSchema.parse({
      version: 1,
      timeoutMs: 60_000,
      captureArtifacts: false,
      steps: text
        ? [
            {
              action: "assertVisible",
              locator: { type: "text", value: text },
              timeoutMs: 5000,
            },
          ]
        : [
            {
              action: "assertVisible",
              locator: { type: "css", value: "body" },
              timeoutMs: 5000,
            },
          ],
    }),
  };
}
