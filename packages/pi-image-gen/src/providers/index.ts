import { commandExists } from "../config.ts";
import type { ImageProvider, ImageProviderSelection } from "../types.ts";
import { agyProvider } from "./agy.ts";
import { codexProvider } from "./codex.ts";

export async function resolveImageProvider(selection: ImageProviderSelection): Promise<ImageProvider> {
  if (selection === "codex") return codexProvider;
  if (selection === "agy") return agyProvider;
  if (await commandExists("codex")) return codexProvider;
  if (await commandExists("agy")) return agyProvider;
  throw new Error("No supported image provider CLI found on PATH: codex or agy.");
}
