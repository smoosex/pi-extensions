import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { VisionProviderSelection } from "./types.ts";

const DEFAULT_VISION_PROVIDER: VisionProviderSelection = "codex";
export const DEFAULT_CODEX_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_AGY_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_VISION_MAX_CONCURRENCY = 5;

function parsePositiveInteger(rawValue: string | undefined, fallback: number, minimum: number): number {
  const value = rawValue?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(minimum, Math.floor(parsed));
}

function parsePositiveTimeout(rawValue: string | undefined, fallback: number): number {
  return parsePositiveInteger(rawValue, fallback, 5_000);
}

export function getVisionProviderSelection(rawValue?: unknown): VisionProviderSelection {
  const value = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : process.env.PI_VISION_PROVIDER?.trim().toLowerCase();
  if (value === "auto" || value === "codex" || value === "agy") return value;
  return DEFAULT_VISION_PROVIDER;
}

export function getCodexTimeoutMs(): number {
  return parsePositiveTimeout(process.env.PI_VISION_CODEX_TIMEOUT_MS, DEFAULT_CODEX_TIMEOUT_MS);
}

export function getAgyTimeoutMs(): number {
  return parsePositiveTimeout(process.env.PI_VISION_AGY_TIMEOUT_MS, DEFAULT_AGY_TIMEOUT_MS);
}

export function getVisionMaxConcurrency(): number {
  return parsePositiveInteger(process.env.PI_VISION_MAX_CONCURRENCY, DEFAULT_VISION_MAX_CONCURRENCY, 1);
}

export function getAgyModel(rawValue?: string): string | undefined {
  return rawValue?.trim() || process.env.PI_VISION_AGY_MODEL?.trim() || undefined;
}

export async function commandExists(command: string): Promise<boolean> {
  const pathValue = process.env.PATH ?? "";
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension}`);
      try {
        await access(candidate, constants.X_OK);
        return true;
      } catch {}
    }
  }
  return false;
}
