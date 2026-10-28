import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TemplateValues } from "./types.ts";

export function renderTemplate(
  template: string,
  ctx: ExtensionContext | undefined,
  durationMs: number,
  extraValues: TemplateValues = {},
): string {
  const cwd = ctx?.cwd || process.cwd();
  const values: TemplateValues = {
    cwd,
    project: basename(cwd),
    model: formatModel(ctx),
    model_short: formatModelShort(ctx),
    duration: formatDuration(durationMs),
    duration_ms: String(durationMs),
    ...extraValues,
  };

  return template.replace(/\{([a-z_]+)\}/g, (match, key) => values[key] ?? match);
}

function formatModel(ctx: ExtensionContext | undefined): string {
  if (!ctx?.model) return "unknown";
  return `${ctx.model.provider}/${ctx.model.id}`;
}

function formatModelShort(ctx: ExtensionContext | undefined): string {
  return ctx?.model?.id || "unknown";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
