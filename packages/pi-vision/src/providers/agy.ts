import { getAgyModel, getAgyTimeoutMs } from "../config.ts";
import { uniqueDirectories } from "../images.ts";
import {
  ERROR_OUTPUT_UPDATE_THROTTLE_MS,
  ProviderExecutionError,
  errorMessageFor,
  formatGoDuration,
  looksLikeCliErrorOutput,
  runProcess,
  tailText,
} from "../process.ts";
import type { ProviderRunInput, ProviderRunResult, VisionProvider } from "../types.ts";

function buildAgyPrompt(userPrompt: string | undefined, imagePaths: string[]): string {
  const lines = ["You are an image recognition assistant. Examine the provided image(s) carefully and describe what you see."];
  if (userPrompt && userPrompt.trim()) {
    lines.push("", "Focus on the following request:", userPrompt.trim());
  } else {
    lines.push(
      "",
      "Cover by default: the overall scene and subject, any visible text (transcribe it verbatim as OCR), objects and people, colors, layout, and any other notable details. Be thorough but well organized.",
    );
  }
  lines.push(
    "",
    "Attached local image paths:",
    ...imagePaths.map((imagePath, index) => `Image ${index + 1}: ${imagePath}`),
    "",
    "If multiple images are attached, describe each one and how they relate. Answer in the same language as the user's request (default to Chinese when unclear). Return only your description as plain text.",
  );
  return lines.join("\n");
}

export const agyProvider: VisionProvider = {
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
      publishStatus("Running agy for image recognition...");

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
      if (input.signal?.aborted) throw new Error("Agy image recognition was aborted.");
      if (processResult.code !== 0) {
        throw new ProviderExecutionError(`agy --print failed with code ${processResult.code ?? "unknown"}.${processResult.stderr ? `\n${processResult.stderr}` : ""}`, {
          stdout: processResult.stdout,
          stderr: processResult.stderr,
          details: { provider: "agy", command: "agy", args: detailsArgs(), model, timeoutMs, processTimeoutMs, elapsedMs: Date.now() - input.startedAt },
        });
      }

      const description = processResult.stdout.trim();
      if (!description) {
        throw new ProviderExecutionError("Agy returned an empty description.", {
          stdout: processResult.stdout,
          stderr: processResult.stderr,
          details: { provider: "agy", command: "agy", args: detailsArgs(), model, timeoutMs, processTimeoutMs, elapsedMs: Date.now() - input.startedAt },
        });
      }

      input.onUpdate?.({
        content: [{ type: "text", text: "Agy completed image recognition." }],
        details: { provider: "agy", descriptionLength: description.length },
      });

      return {
        provider: "agy",
        description,
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
