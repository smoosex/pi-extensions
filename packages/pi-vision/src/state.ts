import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { VisionOverrideState, VisionProviderSelection } from "./types.ts";

interface VisionState {
  override?: VisionOverrideState;
  provider?: VisionProviderSelection;
}

const STATE_FILE = "image-vision.json";

function getStatePath(): string {
  return join(getAgentDir(), STATE_FILE);
}

function isValidOverride(value: unknown): value is VisionOverrideState {
  return value === "on" || value === "off" || value === "auto";
}

function isValidProvider(value: unknown): value is VisionProviderSelection {
  return value === "auto" || value === "codex" || value === "agy";
}

export async function loadVisionState(): Promise<VisionState> {
  try {
    const raw = await readFile(getStatePath(), "utf8");
    const data = JSON.parse(raw) as Partial<VisionState>;
    return {
      override: isValidOverride(data.override) ? data.override : undefined,
      provider: isValidProvider(data.provider) ? data.provider : undefined,
    };
  } catch {
    return {};
  }
}

export async function saveVisionState(patch: Partial<VisionState>): Promise<void> {
  try {
    const next: VisionState = { ...(await loadVisionState()), ...patch };
    const path = getStatePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    // best-effort; in-memory state is still updated by the caller
  }
}
