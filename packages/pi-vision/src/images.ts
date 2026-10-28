import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function expandReturnedPath(rawPath: string, cwd: string): string {
  let value = rawPath.trim().replace(/^['"]|['"]$/g, "");
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

export function uniqueDirectories(paths: string[]): string[] {
  return [...new Set(paths.map((path) => dirname(path)))];
}
