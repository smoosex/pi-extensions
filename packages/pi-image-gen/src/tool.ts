import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { type AgentToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getImageGenMaxConcurrency, getImageProviderSelection, readPersistedImageProvider, writePersistedImageProvider } from "./config.ts";
import { mimeTypeForImage, resolveInputImagePath, validateGeneratedImagePath } from "./images.ts";
import { getProviderExecutionOutput, errorMessageFor, tailText } from "./process.ts";
import { resolveImageProvider } from "./providers/index.ts";
import { renderImageGenCall, renderImageGenResult } from "./render.ts";
import type { ImageGenParams, ImageGenToolDetails, ImageProviderId, ImageProviderSelection } from "./types.ts";

const PROVIDER_OPTIONS: ImageProviderSelection[] = ["auto", "codex", "agy"];

let activeImageGenerations = 0;
const pendingImageGenerationGrants: Array<() => void> = [];

function pumpImageGenerationQueue() {
  const maxConcurrency = getImageGenMaxConcurrency();
  while (activeImageGenerations < maxConcurrency && pendingImageGenerationGrants.length > 0) {
    pendingImageGenerationGrants.shift()?.();
  }
}

async function acquireImageGenerationSlot(signal: AbortSignal | undefined, onUpdate?: (update: AgentToolResult<unknown>) => void): Promise<() => void> {
  const maxConcurrency = getImageGenMaxConcurrency();
  if (signal?.aborted) throw new Error("Image generation was aborted.");
  if (activeImageGenerations >= maxConcurrency) {
    onUpdate?.({
      content: [{ type: "text", text: `Queued image generation (${activeImageGenerations}/${maxConcurrency} running)...` }],
      details: { queued: true, activeImageGenerations, maxConcurrency },
    });
  }

  return new Promise((resolve, reject) => {
    let queued = true;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const grant = () => {
      if (!queued) return;
      queued = false;
      cleanup();
      activeImageGenerations += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        activeImageGenerations = Math.max(0, activeImageGenerations - 1);
        pumpImageGenerationQueue();
      });
    };
    const onAbort = () => {
      if (!queued) return;
      queued = false;
      const index = pendingImageGenerationGrants.indexOf(grant);
      if (index >= 0) pendingImageGenerationGrants.splice(index, 1);
      cleanup();
      reject(new Error("Image generation was aborted while queued."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    pendingImageGenerationGrants.push(grant);
    pumpImageGenerationQueue();
  });
}

const TOOL_PARAMS = Type.Object({
  prompt: Type.String({ description: "The image prompt to pass to the selected local image generation CLI." }),
  images: Type.Optional(
    Type.Array(Type.String({ description: "Local image path to pass as image context when the selected provider supports or can read it." }), {
      description: "Optional local image paths, including Pi temporary attachment paths.",
    }),
  ),
  provider: Type.Optional(
    Type.String({
      enum: PROVIDER_OPTIONS,
      description: "Provider override for this call; otherwise resolved from image-gen.json, PI_IMAGE_GEN_PROVIDER, or codex.",
    }),
  ),
  model: Type.Optional(Type.String({ description: "Optional provider-specific model. For agy, overrides PI_AGY_IMAGE_GEN_MODEL." })),
});

function parseProviderSelection(value: string): ImageProviderSelection | undefined {
  const normalized = value.trim().toLowerCase();
  return PROVIDER_OPTIONS.find((provider) => provider === normalized);
}

function isFailedImageGenToolDetails(details: unknown): details is Extract<ImageGenToolDetails, { ok: false }> {
  return typeof details === "object" && details !== null && (details as { ok?: unknown }).ok === false;
}

function createFailureResult(
  message: string,
  provider: ImageProviderId | ImageProviderSelection,
  imagePaths: string[],
  output?: { stdout?: string; stderr?: string },
  metadata?: Record<string, unknown>,
): AgentToolResult<ImageGenToolDetails> {
  return {
    content: [
      {
        type: "text",
        text: `Image generation failed via ${provider}: ${message}\nNo fallback image generation was attempted.`,
      },
    ],
    details: {
      ...(metadata ?? {}),
      provider,
      ok: false,
      generatedImagePath: "",
      inputImages: imagePaths,
      errorMessage: message,
      stdout: output?.stdout ? tailText(output.stdout) : undefined,
      stderr: output?.stderr ? tailText(output.stderr) : undefined,
    } as ImageGenToolDetails,
    terminate: true,
  };
}

export default function imageGenExtension(pi: ExtensionAPI) {
  const getDefaultProviderSelection = () => getImageProviderSelection();
  const getConfiguredProviderSelection = () => {
    const persisted = readPersistedImageProvider();
    if (persisted === "codex" || persisted === "agy") return persisted;
    const env = process.env.PI_IMAGE_GEN_PROVIDER?.trim().toLowerCase();
    if (env === "codex" || env === "agy") return env;
    return undefined;
  };
  const getEffectiveProviderSelection = (value?: unknown) => {
    const requested = typeof value === "string" && value.trim() ? parseProviderSelection(value) : undefined;
    if (requested === "codex" || requested === "agy") return requested;
    if (requested === "auto") return getConfiguredProviderSelection() ?? "auto";
    return getDefaultProviderSelection();
  };
  const getProviderStatusText = async () => {
    const selection = getDefaultProviderSelection();
    if (selection !== "auto") return `󱇣 ${selection}`;
    const provider = await resolveImageProvider("auto").catch(() => undefined);
    return provider ? `󱇣 auto→${provider.id}` : "󱇣 auto";
  };
  const updateProviderStatus = async (ctx: { hasUI?: boolean; ui?: { setStatus?: (key: string, value: string | undefined) => void } }) => {
    if (!ctx.hasUI || !ctx.ui?.setStatus) return;
    ctx.ui.setStatus("image-gen-provider", await getProviderStatusText());
  };

  pi.on("session_start", async (_event, ctx) => {
    await updateProviderStatus(ctx);
  });

  pi.registerCommand("image-provider", {
    description: "Switch default provider for image_gen: auto, codex, or agy",
    getArgumentCompletions(prefix: string) {
      const normalized = prefix.trim().toLowerCase();
      return PROVIDER_OPTIONS.filter((provider) => provider.startsWith(normalized)).map((provider) => ({ value: provider, label: provider }));
    },
    handler: async (args, ctx) => {
      const rawValue = args.trim();
      let nextProvider = parseProviderSelection(rawValue);
      if (!nextProvider && rawValue) {
        ctx.ui.notify(`Unknown image provider: ${rawValue}`, "error");
        return;
      }
      if (!nextProvider) {
        const choice = await ctx.ui.select("Select image_gen provider", PROVIDER_OPTIONS);
        nextProvider = choice ? parseProviderSelection(choice) : undefined;
      }
      if (!nextProvider) return;
      try {
        await writePersistedImageProvider(nextProvider);
      } catch (error) {
        ctx.ui.notify(`Failed to persist image provider: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }
      await updateProviderStatus(ctx);
      ctx.ui.notify(`image_gen provider set to ${nextProvider}`, "info");
    },
  });

  pi.registerTool({
    name: "image_gen",
    label: "Image Gen",
    description: "Generate images through a selected local image-generation CLI provider: codex or agy. Use this tool for image generation.",
    promptSnippet: "Generate images via local image-generation CLIs; MUST be used for requested image creation.",
    promptGuidelines: [
      "When the user asks to generate, create, draw, render, or make an image, image_gen MUST be called.",
      "For multiple independent image requests, issue multiple image_gen tool calls in the same assistant turn so they can execute in parallel.",
      "When the user attaches images, pass their local temporary image paths through image_gen.images.",
      "If image_gen fails or returns no image, stop and report the failure reason directly; do not call bash, Python, write, SVG/vector generation, Image API scripts, or another provider unless the user explicitly asks for a fallback.",
    ],
    parameters: TOOL_PARAMS,
    executionMode: "parallel",
    renderCall(args, theme, context) {
      const displayArgs = typeof args === "object" && args !== null ? { ...args, provider: getEffectiveProviderSelection((args as ImageGenParams).provider) } : args;
      return renderImageGenCall(displayArgs, theme, context);
    },
    renderResult: renderImageGenResult,
    async execute(_toolCallId, params: ImageGenParams, signal, onUpdate, ctx) {
      const startedAt = Date.now();
      const providerSelection = getEffectiveProviderSelection(params.provider);
      let providerId: ImageProviderId | ImageProviderSelection = providerSelection;
      let imagePaths: string[] = [];

      try {
        imagePaths = await Promise.all((params.images ?? []).map((imagePath) => resolveInputImagePath(imagePath, ctx.cwd)));
        const provider = await resolveImageProvider(providerSelection);
        providerId = provider.id;
        await updateProviderStatus(ctx);
        const releaseSlot = await acquireImageGenerationSlot(signal, onUpdate);
        const providerResult = await (async () => {
          try {
            return await provider.run({
              prompt: params.prompt,
              imagePaths,
              cwd: ctx.cwd,
              model: params.model,
              signal,
              startedAt,
              onUpdate,
            });
          } finally {
            releaseSlot();
          }
        })();

        await validateGeneratedImagePath(providerResult.generatedImagePath, {
          startedAtMs: startedAt,
          inputImages: imagePaths,
          providerLabel: provider.label,
        });

        const imageData = await readFile(providerResult.generatedImagePath);
        const mimeType = mimeTypeForImage(imageData, providerResult.generatedImagePath);

        onUpdate?.({
          content: [{ type: "text", text: `${provider.label} generated ${basename(providerResult.generatedImagePath)}.` }],
          details: { provider: provider.id, generatedImagePath: providerResult.generatedImagePath, mimeType, byteCount: imageData.byteLength },
        });

        return {
          content: [
            { type: "text", text: `Generated image via ${provider.label}: ${providerResult.generatedImagePath}` },
            { type: "image", data: imageData.toString("base64"), mimeType },
          ],
          details: {
            ...(providerResult.metadata ?? {}),
            provider: providerResult.provider,
            ok: true,
            generatedImagePath: providerResult.generatedImagePath,
            mimeType,
            byteCount: imageData.byteLength,
            cliResult: providerResult.cliResult,
            inputImages: imagePaths,
            stdout: providerResult.stdout,
            stderr: providerResult.stderr,
          } as ImageGenToolDetails,
        };
      } catch (error) {
        const message = errorMessageFor(error);
        const output = getProviderExecutionOutput(error);
        const failure = createFailureResult(message, providerId, imagePaths, output, output.details);
        onUpdate?.(failure);
        return failure;
      }
    },
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== "image_gen") return;
    if (isFailedImageGenToolDetails(event.details)) return { isError: true };
  });
}
