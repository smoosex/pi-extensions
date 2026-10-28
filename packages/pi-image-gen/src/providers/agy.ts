import { basename } from "node:path";
import { getAgyModel, getAgyTimeoutMs } from "../config.ts";
import { expandReturnedPath, uniqueDirectories, validateGeneratedImagePath } from "../images.ts";
import { parseCliImageResult } from "../json.ts";
import {
  ERROR_OUTPUT_UPDATE_THROTTLE_MS,
  ProviderExecutionError,
  errorMessageFor,
  formatGoDuration,
  looksLikeCliErrorOutput,
  runProcess,
  tailText,
} from "../process.ts";
import type { CliImageResult, ImageProvider, ProviderRunInput, ProviderRunResult } from "../types.ts";

function buildAgyPrompt(userPrompt: string, imagePaths: string[]): string {
  const schemaExample = JSON.stringify({ ok: true, generatedImagePath: "/absolute/path/to/generated-image.png", message: "", sessionId: "" });
  const lines = [
    "Generate exactly one raster image using your available image generation capability.",
    "Do not generate SVG, HTML, code-only drawings, or text-only descriptions.",
    "After the image is generated, return only a JSON object and no markdown or prose.",
    `The JSON object must match this shape: ${schemaExample}`,
    "Set ok to true only if a generated image file exists on disk.",
    "Set generatedImagePath to the absolute filesystem path of the generated image file.",
    "Set message to an empty string on success; otherwise set it to a concise failure reason.",
    "Set sessionId to the current session id if available; otherwise set it to an empty string.",
    "Never return an attached input image path or a clipboard temporary image path as generatedImagePath.",
  ];

  if (imagePaths.length > 0) {
    lines.push(
      "",
      "Attached local image paths:",
      ...imagePaths.map((imagePath, index) => `Image ${index + 1}: ${imagePath}`),
      "Use these local images according to the user's prompt. Treat them as references unless the prompt clearly asks to edit or transform them.",
    );
  }

  lines.push("", "Image prompt:", userPrompt);
  return lines.join("\n");
}

function extractImagePathCandidates(text: string): string[] {
  const candidates: string[] = [];
  const push = (value: string | undefined) => {
    const cleaned = value?.trim().replace(/[.,;:]+$/, "");
    if (cleaned && !candidates.includes(cleaned)) candidates.push(cleaned);
  };

  for (const match of text.matchAll(/\[[^\]]*\]\((file:\/\/[^)]+|\/[\s\S]*?\.(?:png|jpe?g|webp))\)/gi)) push(match[1]);
  for (const match of text.matchAll(/file:\/\/[^\s)\]]+\.(?:png|jpe?g|webp)/gi)) push(match[0]);
  for (const match of text.matchAll(/["'`]((?:\/|~\/)[^"'`\n]+?\.(?:png|jpe?g|webp))["'`]/gi)) push(match[1]);
  for (const match of text.matchAll(/(?:^|[\s(])((?:\/|~\/)[^\n\r"'`)\]]+?\.(?:png|jpe?g|webp))(?:$|[\s)\]])/gi)) push(match[1]);

  return candidates;
}

async function selectValidAgyImagePath(candidates: string[], input: ProviderRunInput): Promise<string> {
  const errors: string[] = [];
  for (const candidate of candidates) {
    const imagePath = expandReturnedPath(candidate, input.cwd);
    try {
      await validateGeneratedImagePath(imagePath, {
        startedAtMs: input.startedAt,
        inputImages: input.imagePaths,
        providerLabel: "Agy",
      });
      return imagePath;
    } catch (error) {
      errors.push(errorMessageFor(error));
    }
  }
  throw new Error(errors.length > 0 ? errors.join(" ") : "Agy did not return an image path.");
}

export const agyProvider: ImageProvider = {
  id: "agy",
  label: "Agy CLI",
  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const timeoutMs = getAgyTimeoutMs();
    const processTimeoutMs = timeoutMs + 10_000;
    const model = getAgyModel(input.model);
    const agyPrompt = buildAgyPrompt(input.prompt, input.imagePaths);
    const args = ["--dangerously-skip-permissions", "--print-timeout", formatGoDuration(timeoutMs)];
    for (const dir of uniqueDirectories(input.imagePaths)) args.push("--add-dir", dir);
    if (model) args.push("--model", model);
    args.push("--print", agyPrompt);
    const detailsArgs = () => args.map((arg) => (arg === agyPrompt ? "<prompt>" : arg));
    let stdoutTail = "";
    let stderrTail = "";

    try {
      let lastErrorUpdateAt = 0;
      const publishStatus = (message: string, includeOutput = false) => {
        input.onUpdate?.({
          content: [{ type: "text", text: message }],
          details: {
            provider: "agy",
            command: "agy",
            args: detailsArgs(),
            images: input.imagePaths,
            model,
            timeoutMs,
            processTimeoutMs,
            elapsedMs: Date.now() - input.startedAt,
            stdoutTail: includeOutput && stdoutTail ? tailText(stdoutTail, 2_000) : undefined,
            stderrTail: includeOutput && stderrTail ? tailText(stderrTail, 2_000) : undefined,
          },
        });
      };
      publishStatus("Running agy for image generation...");

      const processResult = await runProcess("agy", args, undefined, input.cwd, {
        signal: input.signal,
        timeoutMs: processTimeoutMs,
        processLabel: "agy --print",
        onOutput(stream, chunk, captured) {
          stdoutTail = captured.stdout;
          stderrTail = captured.stderr;
          const now = Date.now();
          if (looksLikeCliErrorOutput(chunk) && (stream === "stderr" || chunk.length < 2_000) && now - lastErrorUpdateAt >= ERROR_OUTPUT_UPDATE_THROTTLE_MS) {
            lastErrorUpdateAt = now;
            publishStatus("agy reported diagnostic output.", true);
          }
        },
      });
      if (input.signal?.aborted) throw new Error("Agy image generation was aborted.");
      if (processResult.code !== 0) {
        throw new ProviderExecutionError(`agy --print failed with code ${processResult.code ?? "unknown"}.${processResult.stderr ? `\n${processResult.stderr}` : ""}`, {
          stdout: processResult.stdout,
          stderr: processResult.stderr,
          details: { provider: "agy", command: "agy", args: detailsArgs(), model, timeoutMs, processTimeoutMs, elapsedMs: Date.now() - input.startedAt },
        });
      }

      let cliResult: CliImageResult | undefined;
      const candidates: string[] = [];
      try {
        cliResult = parseCliImageResult(processResult.stdout, "Agy");
        if (cliResult.generatedImagePath) candidates.push(cliResult.generatedImagePath);
      } catch {}
      candidates.push(...extractImagePathCandidates(processResult.stdout));

      if (cliResult && !cliResult.ok && candidates.length === 0) {
        throw new Error(cliResult.message || "Agy reported image generation failure.");
      }

      const imagePath = await selectValidAgyImagePath([...new Set(candidates)], input);
      const result = cliResult ?? { ok: true, generatedImagePath: imagePath, message: "", sessionId: "" };

      input.onUpdate?.({
        content: [{ type: "text", text: `Agy generated ${basename(imagePath)}.` }],
        details: { provider: "agy", generatedImagePath: imagePath, model },
      });

      return {
        provider: "agy",
        generatedImagePath: imagePath,
        cliResult: { ...result, ok: true, generatedImagePath: imagePath, message: result.message ?? "" },
        inputImages: input.imagePaths,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        metadata: {
          command: "agy",
          args: detailsArgs(),
          timeoutMs,
          processTimeoutMs,
          elapsedMs: Date.now() - input.startedAt,
          model,
        },
      };
    } catch (error) {
      if (error instanceof ProviderExecutionError) throw error;
      throw new ProviderExecutionError(errorMessageFor(error), {
        stdout: stdoutTail,
        stderr: stderrTail,
        details: { provider: "agy", command: "agy", args: detailsArgs(), model, timeoutMs, processTimeoutMs, elapsedMs: Date.now() - input.startedAt },
      });
    }
  },
};
