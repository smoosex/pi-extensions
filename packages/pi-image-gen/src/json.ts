import type { CliImageResult } from "./types.ts";

export function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("CLI did not return JSON.");
    return JSON.parse(text.slice(start, end + 1));
  }
}

export function parseCliImageResult(text: string, label: string): CliImageResult {
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object") throw new Error(`${label} result is not an object.`);
  const result = parsed as Partial<CliImageResult>;
  if (typeof result.ok !== "boolean") throw new Error(`${label} result missing boolean ok.`);
  if (typeof result.generatedImagePath !== "string") throw new Error(`${label} result missing generatedImagePath.`);
  if (result.message !== undefined && typeof result.message !== "string") throw new Error(`${label} result message must be a string.`);
  if (result.sessionId !== undefined && typeof result.sessionId !== "string") throw new Error(`${label} result sessionId must be a string.`);
  return {
    ok: result.ok,
    generatedImagePath: result.generatedImagePath,
    message: result.message ?? "",
    sessionId: result.sessionId ?? "",
  };
}
