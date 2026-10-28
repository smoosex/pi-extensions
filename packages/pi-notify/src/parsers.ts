import type { MessageSource } from "./types.ts";

export function parseMessageSource(value: string | undefined): MessageSource {
  return value?.trim().toLowerCase() === "user" ? "user" : "assistant";
}

export function parseMessageMax(value: string | undefined): number {
  const parsed = Number.parseInt(value || "80", 10);
  if (!Number.isFinite(parsed)) return 80;
  return Math.max(0, Math.min(parsed, 500));
}
