import { constants, existsSync, readFileSync } from "node:fs";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ImageProviderSelection } from "./types.ts";

const DEFAULT_IMAGE_PROVIDER: ImageProviderSelection = "codex";
export const DEFAULT_CODEX_TIMEOUT_MS = 15 * 60 * 1000;
export const DEFAULT_AGY_TIMEOUT_MS = 15 * 60 * 1000;
export const DEFAULT_IMAGE_GEN_MAX_CONCURRENCY = 5;

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

function normalizeProviderSelection(value: string | undefined): ImageProviderSelection | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "auto" || normalized === "codex" || normalized === "agy") return normalized;
  return undefined;
}

export function getImageGenConfigPath(): string {
  return join(getAgentDir(), "image-gen.json");
}

export function readPersistedImageProvider(): ImageProviderSelection | undefined {
  const path = getImageGenConfigPath();
  try {
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { provider?: unknown };
    return normalizeProviderSelection(typeof parsed?.provider === "string" ? parsed.provider : undefined);
  } catch {
    return undefined;
  }
}

export async function writePersistedImageProvider(provider: ImageProviderSelection): Promise<void> {
  const path = getImageGenConfigPath();
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `.image-gen.${process.pid}.tmp`);
  await writeFile(tmpPath, `${JSON.stringify({ provider }, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

export function getImageProviderSelection(rawValue?: unknown): ImageProviderSelection {
  const candidates: Array<string | undefined> = [
    typeof rawValue === "string" ? rawValue : undefined,
    readPersistedImageProvider(),
    process.env.PI_IMAGE_GEN_PROVIDER,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeProviderSelection(candidate);
    if (normalized) return normalized;
  }
  return DEFAULT_IMAGE_PROVIDER;
}

export function getCodexTimeoutMs(): number {
  return parsePositiveTimeout(process.env.PI_CODEX_IMAGE_GEN_TIMEOUT_MS, DEFAULT_CODEX_TIMEOUT_MS);
}

export function getAgyTimeoutMs(): number {
  return parsePositiveTimeout(process.env.PI_AGY_IMAGE_GEN_TIMEOUT_MS, DEFAULT_AGY_TIMEOUT_MS);
}

export function getImageGenMaxConcurrency(): number {
  return parsePositiveInteger(process.env.PI_IMAGE_GEN_MAX_CONCURRENCY, DEFAULT_IMAGE_GEN_MAX_CONCURRENCY, 1);
}

export function getAgyModel(rawValue?: string): string | undefined {
  return rawValue?.trim() || process.env.PI_AGY_IMAGE_GEN_MODEL?.trim() || undefined;
}

export function getCodexDataDir(): string {
  return join(homedir(), ".codex");
}

export function getGeneratedImagesRoot(): string {
  return join(getCodexDataDir(), "generated_images");
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
