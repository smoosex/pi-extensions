import { keyHint, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatDuration, formatTimerDuration } from "./process.ts";
import type { TimerRenderState } from "./types.ts";

const COLLAPSED_PROMPT_CHARS = 140;
const COLLAPSED_RESULT_LINES = 10;

function truncatePlainText(text: string, maxLength: number): { text: string; truncated: boolean } {
  const limit = Math.max(1, maxLength);
  return text.length > limit ? { text: `${text.slice(0, limit - 1)}…`, truncated: true } : { text, truncated: false };
}

function compactSingleLine(text: string, maxLength: number): { text: string; truncated: boolean } {
  return truncatePlainText(text.trim().replace(/\s+/g, " "), maxLength);
}

function formatExpandNotice(theme: any, remainingLines: number, totalLines: number): string {
  let hint: string;
  try {
    hint = keyHint("app.tools.expand", "to expand");
  } catch {
    hint = `${theme.fg("dim", "ctrl+o")} ${theme.fg("muted", "to expand")}`;
  }
  return `${theme.fg("muted", `... (${remainingLines} more lines, ${totalLines} total,`)} ${hint}${theme.fg("muted", ")")}`;
}

function getResultText(result: AgentToolResult<unknown>, showImages: boolean): string {
  const text = result.content
    .filter((content) => content.type === "text")
    .map((content) => content.text.trim())
    .filter(Boolean)
    .join("\n");
  const imageCount = result.content.filter((content) => content.type === "image").length;
  const imageHint = imageCount > 0 && !showImages ? `[Image: ${imageCount} generated image${imageCount === 1 ? "" : "s"}]` : "";
  return [text, imageHint].filter(Boolean).join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringDetail(details: Record<string, unknown>, key: string): string | undefined {
  const value = details[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumberDetail(details: Record<string, unknown>, key: string): number | undefined {
  const value = details[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStringArrayDetail(details: Record<string, unknown>, key: string): string[] {
  const value = details[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export function formatExpandedDetails(details: unknown): string {
  if (!isRecord(details)) return "";
  const sections: string[] = [];
  const metadata: string[] = [];
  const provider = getStringDetail(details, "provider");
  const generatedImagePath = getStringDetail(details, "generatedImagePath");
  const mimeType = getStringDetail(details, "mimeType");
  const byteCount = getNumberDetail(details, "byteCount");
  const timeoutMs = getNumberDetail(details, "timeoutMs");
  const processTimeoutMs = getNumberDetail(details, "processTimeoutMs");
  const elapsedMs = getNumberDetail(details, "elapsedMs");
  const model = getStringDetail(details, "model");
  const errorMessage = getStringDetail(details, "errorMessage");
  if (provider) metadata.push(`Provider: ${provider}`);
  if (generatedImagePath) metadata.push(`Generated image: ${generatedImagePath}`);
  if (mimeType) metadata.push(`MIME type: ${mimeType}`);
  if (byteCount !== undefined) metadata.push(`Bytes: ${byteCount}`);
  if (model) metadata.push(`Model: ${model}`);
  if (timeoutMs !== undefined) metadata.push(`Timeout: ${formatDuration(timeoutMs)}`);
  if (processTimeoutMs !== undefined) metadata.push(`Process timeout: ${formatDuration(processTimeoutMs)}`);
  if (elapsedMs !== undefined) metadata.push(`Elapsed: ${formatTimerDuration(elapsedMs)}`);
  if (errorMessage) metadata.push(`Error: ${errorMessage}`);
  if (metadata.length > 0) sections.push(`Details:\n${metadata.join("\n")}`);

  const command = getStringDetail(details, "command");
  const commandArgs = getStringArrayDetail(details, "args");
  if (command) sections.push(`Command:\n${[command, ...commandArgs].join(" ")}`);

  const inputImages = getStringArrayDetail(details, "inputImages");
  const updateImages = getStringArrayDetail(details, "images");
  const images = inputImages.length > 0 ? inputImages : updateImages;
  if (images.length > 0) sections.push(`Images:\n${images.join("\n")}`);

  const cliResult = details.cliResult;
  if (isRecord(cliResult)) sections.push(`CLI result:\n${JSON.stringify(cliResult, null, 2)}`);

  const stderr = getStringDetail(details, "stderr");
  const stderrTail = stderr ? undefined : getStringDetail(details, "stderrTail");
  if (stderr) sections.push(`stderr:\n${stderr.trimEnd()}`);
  if (stderrTail) sections.push(`stderr tail:\n${stderrTail.trimEnd()}`);

  const stdout = getStringDetail(details, "stdout");
  const stdoutTail = stdout ? undefined : getStringDetail(details, "stdoutTail");
  if (stdout) sections.push(`stdout:\n${stdout.trimEnd()}`);
  if (stdoutTail) sections.push(`stdout tail:\n${stdoutTail.trimEnd()}`);

  return sections.join("\n\n");
}

export function renderImageGenCall(args: any, theme: any, context: any) {
  const state = context.state as TimerRenderState;
  if (context.executionStarted && state.startedAt === undefined) {
    state.startedAt = Date.now();
    state.endedAt = undefined;
  }
  const title = theme.fg("toolTitle", theme.bold("image_gen"));
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const provider = typeof args.provider === "string" ? args.provider.trim() : "";
  const model = typeof args.model === "string" ? args.model.trim() : "";
  const promptPreview = compactSingleLine(prompt, COLLAPSED_PROMPT_CHARS);
  const images = Array.isArray(args.images) ? args.images.filter((image: unknown): image is string => typeof image === "string" && image.trim().length > 0) : [];
  const lines = [title];
  const metadata = [provider ? `provider: ${provider}` : undefined, model ? `model: ${model}` : undefined].filter(Boolean).join(", ");
  if (metadata) lines.push(theme.fg("muted", metadata));
  if (prompt) lines.push(theme.fg("muted", context.expanded ? prompt : promptPreview.text));
  if (context.expanded && images.length > 0) lines.push(theme.fg("muted", `Images:\n${images.join("\n")}`));
  return new Text(lines.join("\n"), 0, 0);
}

export function renderImageGenResult(result: AgentToolResult<unknown>, options: any, theme: any, context: any) {
  const state = context.state as TimerRenderState;
  state.startedAt ??= Date.now();
  if (options.isPartial && !state.interval) {
    state.interval = setInterval(() => context.invalidate(), 1000);
    (state.interval as { unref?: () => void }).unref?.();
  }
  if (!options.isPartial || context.isError) {
    state.endedAt ??= Date.now();
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = undefined;
    }
  }
  const output = getResultText(result, context.showImages);
  const outputLines = output ? output.split("\n") : [];
  const visibleOutputLines = options.expanded ? outputLines : outputLines.slice(0, COLLAPSED_RESULT_LINES);
  const details = formatExpandedDetails(result.details);
  const detailsLines = details ? details.split("\n") : [];
  const hiddenLines = options.expanded ? 0 : Math.max(0, outputLines.length - visibleOutputLines.length) + detailsLines.length;
  const totalLines = outputLines.length + detailsLines.length;
  let body = visibleOutputLines.map((line) => theme.fg(context.isError ? "error" : "toolOutput", line)).join("\n");
  if (hiddenLines > 0) body = body ? `${body}\n${formatExpandNotice(theme, hiddenLines, totalLines)}` : formatExpandNotice(theme, hiddenLines, totalLines);
  const label = options.isPartial ? "Elapsed" : "Took";
  const elapsed = formatTimerDuration((state.endedAt ?? Date.now()) - state.startedAt);
  const lines = [body || undefined, options.expanded && details ? theme.fg("muted", details) : undefined, theme.fg("muted", `${label} ${elapsed}`)].filter(Boolean);
  return new Text(lines.join("\n\n"), 0, 0);
}
