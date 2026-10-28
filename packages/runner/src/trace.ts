import { readFile, writeFile, stat } from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

// Retain action/timing evidence only. Full traces can contain response bodies,
// cookies, console messages and form data; they are never retained by this MVP.
export async function sanitizeTrace(path: string, output = path) {
  if ((await stat(path)).size > 8 * 1024 * 1024)
    throw new Error("Trace capture exceeds the 8 MiB processing limit.");
  let expanded = 0;
  const entries = unzipSync(await readFile(path), {
    filter(file) {
      // Never decompress captured resources, bodies or network payloads.
      if (!file.name.endsWith(".trace")) return false;
      expanded += file.originalSize;
      if (expanded > 8 * 1024 * 1024)
        throw new Error("Trace events exceed the 8 MiB processing limit.");
      return true;
    },
  });
  const safe: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.endsWith(".trace")) continue;
    safe[name.replace(/\.trace$/, ".network")] = strToU8("");
    const events: string[] = [];
    for (const line of strFromU8(bytes).split("\n").filter(Boolean)) {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (!["context-options", "before", "after"].includes(String(event.type)))
        continue;
      const retained: Record<string, unknown> = {};
      for (const key of [
        "type",
        "version",
        "origin",
        "browserName",
        "platform",
        "wallTime",
        "monotonicTime",
        "callId",
        "startTime",
        "endTime",
        "apiName",
        "class",
        "method",
        "pageId",
        "parentId",
      ])
        if (event[key] !== undefined) retained[key] = event[key];
      if (event.type === "before") retained.params = {};
      if (event.type === "after" && event.error)
        retained.error = {
          message:
            "Action failed. Inspect the sanitized FlowGuard assertion for details.",
        };
      events.push(JSON.stringify(retained));
    }
    safe[name] = strToU8(events.join("\n") + "\n");
  }
  await writeFile(output, zipSync(safe));
}
