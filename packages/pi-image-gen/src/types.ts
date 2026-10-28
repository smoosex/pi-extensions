import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export const IMAGE_PROVIDER_IDS = ["codex", "agy"] as const;
export const IMAGE_PROVIDER_SELECTIONS = ["auto", ...IMAGE_PROVIDER_IDS] as const;

export type ImageProviderId = (typeof IMAGE_PROVIDER_IDS)[number];
export type ImageProviderSelection = (typeof IMAGE_PROVIDER_SELECTIONS)[number];

export interface ImageGenParams {
  prompt: string;
  images?: string[];
  provider?: ImageProviderSelection;
  model?: string;
}

export interface CliImageResult {
  ok: boolean;
  generatedImagePath: string;
  message: string;
  sessionId: string;
}

export type ProviderStatusUpdate = AgentToolResult<unknown>;

export type ProviderStatusHandler = (update: ProviderStatusUpdate) => void;

export interface ProviderRunInput {
  prompt: string;
  imagePaths: string[];
  cwd: string;
  model?: string;
  signal?: AbortSignal;
  startedAt: number;
  onUpdate?: ProviderStatusHandler;
}

export interface ProviderRunResult {
  provider: ImageProviderId;
  generatedImagePath: string;
  cliResult: CliImageResult;
  inputImages: string[];
  stdout: string;
  stderr: string;
  metadata?: Record<string, unknown>;
}

export interface ImageProvider {
  id: ImageProviderId;
  label: string;
  run(input: ProviderRunInput): Promise<ProviderRunResult>;
}

export type ImageGenToolDetails =
  | {
      provider: ImageProviderId;
      ok: true;
      generatedImagePath: string;
      mimeType: string;
      byteCount: number;
      cliResult: CliImageResult;
      inputImages: string[];
      stdout: string;
      stderr: string;
      command?: string;
      args?: string[];
      timeoutMs?: number;
      processTimeoutMs?: number;
      elapsedMs?: number;
      model?: string;
    }
  | {
      provider: ImageProviderId | ImageProviderSelection;
      ok: false;
      generatedImagePath: "";
      inputImages: string[];
      errorMessage: string;
      stdout?: string;
      stderr?: string;
      command?: string;
      args?: string[];
      timeoutMs?: number;
      processTimeoutMs?: number;
      elapsedMs?: number;
      model?: string;
    };

export interface TimerRenderState {
  startedAt?: number;
  endedAt?: number;
  interval?: ReturnType<typeof setInterval>;
}
