// pi-persona — CLI persona documents and strict YAML metadata loading.
// Paths follow getAgentDir(); only missing files are optional, never malformed documents.
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import matter from "gray-matter";
import type { SoulDefinition, SoulTraits } from "./types.js";
import { DEFAULT_TRAITS } from "./types.js";

export type SoulWarningSink = (message: string) => void;

export interface LoadSoulOptions {
  onWarning?: SoulWarningSink;
}

type FileStamp =
  | { exists: true; mtimeMs: number; size: number }
  | { exists: false };

interface SoulCacheStamp {
  agentDir: string;
  soul: FileStamp;
  identify: FileStamp;
  userProfile: FileStamp;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function getFileStamp(filePath: string): FileStamp {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error(`[pi-persona] Expected a file: ${filePath}`);
    return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size };
  } catch (error) {
    if (isMissing(error)) return { exists: false };
    throw error;
  }
}

function getSoulCacheStamp(agentDir: string): SoulCacheStamp {
  return {
    agentDir,
    soul: getFileStamp(path.join(agentDir, "SOUL.md")),
    identify: getFileStamp(path.join(agentDir, "IDENTIFY.md")),
    userProfile: getFileStamp(path.join(agentDir, "USER.md")),
  };
}

function sameFileStamp(a: FileStamp, b: FileStamp): boolean {
  if (a.exists !== b.exists) return false;
  if (!a.exists || !b.exists) return true;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function sameSoulCacheStamp(a: SoulCacheStamp | undefined, b: SoulCacheStamp): boolean {
  return !!a && a.agentDir === b.agentDir &&
    sameFileStamp(a.soul, b.soul) &&
    sameFileStamp(a.identify, b.identify) &&
    sameFileStamp(a.userProfile, b.userProfile);
}

/** Validate before gray-matter can select an executable engine, including after a BOM. */
function parseSafeMatter(raw: string, filePath: string): matter.GrayMatterFile<string> {
  const content = raw.replace(/^\uFEFF/, "");
  if (/^---(?!-)/.test(content) && !/^---(?:\r?\n|$)/.test(content)) {
    throw new Error(`[pi-persona] Only YAML frontmatter is supported in ${filePath}`);
  }
  if (/^---(?:\r?\n|$)/.test(content) && !/^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/.test(content)) {
    throw new Error(`[pi-persona] Unterminated YAML frontmatter in ${filePath}`);
  }
  const parsed = matter(content, {
    language: "yaml",
    engines: { javascript: () => { throw new Error("Executable persona frontmatter is forbidden"); } },
  });
  if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    throw new Error(`[pi-persona] Invalid persona metadata in ${filePath}`);
  }
  return parsed;
}

function readDocument(filePath: string): matter.GrayMatterFile<string> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    if (!isMissing(error)) throw error;
    raw = "";
  }
  return parseSafeMatter(raw, filePath);
}

function buildTraits(metadata: Record<string, unknown>): SoulTraits {
  const traits = { ...DEFAULT_TRAITS };
  for (const key of Object.keys(traits) as (keyof SoulTraits)[]) {
    const value = metadata[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`[pi-persona] IDENTIFY.md trait ${key} must be a number between 0 and 1`);
    }
    traits[key] = value;
  }
  return traits;
}

function buildSoul(metadata: Record<string, unknown>, systemPrompt: string, userProfile: string): SoulDefinition {
  const traits = buildTraits(metadata);
  for (const key of ["name", "emoji", "description"]) {
    const value = metadata[key];
    if (value !== undefined && (typeof value !== "string" || (key !== "description" && !value.trim()))) {
      throw new Error(`[pi-persona] IDENTIFY.md metadata ${key} must be ${key === "description" ? "a string" : "a nonempty string"}`);
    }
  }
  return {
    name: metadata.name === undefined ? "Soul" : (metadata.name as string).trim(),
    emoji: metadata.emoji as string ?? "󰊠",
    description: metadata.description as string ?? "用户自定义灵魂",
    traits,
    systemPrompt,
    ...(userProfile ? { userProfile } : {}),
  };
}

let cachedSoul: SoulDefinition | null | undefined;
let cachedStamp: SoulCacheStamp | undefined;

/** 清除灵魂缓存，/persona reload 时调用。 */
export function invalidateSoulCache(): void {
  cachedSoul = undefined;
  cachedStamp = undefined;
}

/**
 * Read SOUL / IDENTIFY / USER from the CLI agent directory.
 * Missing or empty SOUL disables the persona, but never masks invalid companion documents.
 * The warning option remains API-compatible; invalid documents now throw instead of warning.
 */
export function loadSoul(_options: LoadSoulOptions = {}): SoulDefinition | null {
  const agentDir = path.resolve(getAgentDir());
  const currentStamp = getSoulCacheStamp(agentDir);
  if (cachedSoul !== undefined && sameSoulCacheStamp(cachedStamp, currentStamp)) return cachedSoul;

  const soul = readDocument(path.join(agentDir, "SOUL.md"));
  const identify = readDocument(path.join(agentDir, "IDENTIFY.md"));
  const user = readDocument(path.join(agentDir, "USER.md"));
  const definition = buildSoul(identify.data, soul.content.trim(), user.content.trim());

  // Publish the cache only after every document and metadata field has validated.
  cachedSoul = definition.systemPrompt ? definition : null;
  cachedStamp = currentStamp;
  return cachedSoul;
}
