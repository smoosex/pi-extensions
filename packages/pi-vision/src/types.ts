import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export const VISION_PROVIDER_IDS = ["codex", "agy"] as const;
export const VISION_PROVIDER_SELECTIONS = ["auto", ...VISION_PROVIDER_IDS] as const;

export type VisionProviderId = (typeof VISION_PROVIDER_IDS)[number];
export type VisionProviderSelection = (typeof VISION_PROVIDER_SELECTIONS)[number];

export type VisionOverrideState = "on" | "off" | "auto";

export interface VisionParams {
  images: string[];
  prompt?: string;
  provider?: VisionProviderSelection;
  model?: string;
}

export type ProviderStatusUpdate = AgentToolResult<unknown>;
export type ProviderStatusHandler = (update: ProviderStatusUpdate) => void;

export interface ProviderRunInput {
  prompt?: string;
  imagePaths: string[];
  cwd: string;
  model?: string;
  signal?: AbortSignal;
  startedAt: number;
  onUpdate?: ProviderStatusHandler;
}

export interface ProviderRunResult {
  provider: VisionProviderId;
  description: string;
  inputImages: string[];
  stdout: string;
  stderr: string;
  metadata?: Record<string, unknown>;
}

export interface VisionProvider {
  id: VisionProviderId;
  label: string;
  run(input: ProviderRunInput): Promise<ProviderRunResult>;
}

export type VisionToolDetails = {
  provider: VisionProviderId | VisionProviderSelection;
  ok: boolean;
  errorMessage?: string;
  descriptionLength?: number;
  inputImages: string[];
  stdout?: string;
  stderr?: string;
  command?: string;
  args?: string[];
  model?: string;
  timeoutMs?: number;
  processTimeoutMs?: number;
  elapsedMs?: number;
};

export interface TimerRenderState {
  startedAt?: number;
  endedAt?: number;
  interval?: ReturnType<typeof setInterval>;
}
