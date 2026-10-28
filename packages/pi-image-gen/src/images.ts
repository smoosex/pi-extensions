import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCodexDataDir } from "./config.ts";

export interface GeneratedImageCandidate {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface ImageFormat {
  mimeType: string;
  extension: string;
}

export interface GeneratedImageValidationOptions {
  startedAtMs: number;
  inputImages: string[];
  providerLabel: string;
  requiredRoot?: string;
  requiredRootDescription?: string;
}

export const GENERATED_IMAGE_MTIME_SLOP_MS = 30_000;
export const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function isPathInside(path: string, parent: string): boolean {
  const child = resolve(path);
  const root = resolve(parent);
  const childRelativePath = relative(root, child);
  return childRelativePath === "" || (!!childRelativePath && !childRelativePath.startsWith("..") && !isAbsolute(childRelativePath));
}

export function expandReturnedPath(rawPath: string, cwd: string): string {
  let value = rawPath.trim().replace(/^['"]|['"]$/g, "");
  value = value.replaceAll("~/.codex", getCodexDataDir());
  if (/^file:\/\//i.test(value)) {
    try {
      value = fileURLToPath(value);
    } catch {
      value = decodeURIComponent(value.replace(/^file:\/\//i, ""));
    }
  }
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return isAbsolute(value) ? value : resolve(cwd, value);
}

export function detectImageFormat(data: Buffer): ImageFormat | undefined {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", extension: ".png" };
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mimeType: "image/jpeg", extension: ".jpg" };
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp", extension: ".webp" };
  }
  return undefined;
}

export function mimeTypeForImage(data: Buffer, imagePath: string): string {
  const detected = detectImageFormat(data);
  if (detected) return detected.mimeType;
  const ext = extname(imagePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

export async function validateGeneratedImagePath(imagePath: string, options: GeneratedImageValidationOptions): Promise<void> {
  if (!imagePath.trim()) throw new Error(`${options.providerLabel} did not return a generated image path.`);
  const info = await stat(imagePath).catch((error) => {
    throw new Error(`${options.providerLabel} returned an inaccessible image path ${imagePath}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!info.isFile()) throw new Error(`${options.providerLabel} returned a path that is not a file: ${imagePath}`);
  if (info.size === 0) throw new Error(`${options.providerLabel} returned an empty image file: ${imagePath}`);
  if (info.mtimeMs < options.startedAtMs - GENERATED_IMAGE_MTIME_SLOP_MS) {
    throw new Error(`${options.providerLabel} returned an image older than this run: ${imagePath}`);
  }
  await access(imagePath, constants.R_OK);

  const data = await readFile(imagePath);
  if (!detectImageFormat(data)) throw new Error(`${options.providerLabel} returned an unsupported or invalid image file: ${imagePath}`);

  const normalizedImagePath = resolve(imagePath);
  if (options.inputImages.some((inputImage) => resolve(inputImage) === normalizedImagePath)) {
    throw new Error(`${options.providerLabel} returned one of the input images instead of a generated image: ${imagePath}`);
  }

  if (options.requiredRoot && !isPathInside(imagePath, options.requiredRoot)) {
    const expected = options.requiredRootDescription ?? options.requiredRoot;
    throw new Error(`${options.providerLabel} returned an image outside ${expected}: ${imagePath}`);
  }
}

export async function resolveInputImagePath(rawPath: string, cwd: string): Promise<string> {
  const cleaned = rawPath.trim().replace(/^@+/, "");
  if (!cleaned) throw new Error("Image path cannot be empty.");
  const imagePath = expandReturnedPath(cleaned, cwd);
  const extension = extname(imagePath).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported image format for ${rawPath}. Expected png, jpg, jpeg, or webp.`);
  }
  const info = await stat(imagePath).catch((error) => {
    throw new Error(`Cannot access image ${rawPath}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!info.isFile()) throw new Error(`Image path is not a file: ${rawPath}`);
  if (info.size === 0) throw new Error(`Image file is empty: ${rawPath}`);
  await access(imagePath, constants.R_OK);
  return imagePath;
}

export async function collectGeneratedImageCandidates(dir: string): Promise<GeneratedImageCandidate[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) return collectGeneratedImageCandidates(entryPath);
      if (!entry.isFile() || !SUPPORTED_IMAGE_EXTENSIONS.has(extname(entryPath).toLowerCase())) return [];
      const info = await stat(entryPath);
      return [{ path: entryPath, mtimeMs: info.mtimeMs, size: info.size }];
    }),
  );
  return candidates.flat();
}

export function uniqueDirectories(paths: string[]): string[] {
  return [...new Set(paths.map((path) => dirname(path)))];
}
