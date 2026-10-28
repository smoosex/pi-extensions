import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCodexTimeoutMs } from "../config.ts";
import {
  ERROR_OUTPUT_UPDATE_THROTTLE_MS,
  ProviderExecutionError,
  errorMessageFor,
  looksLikeCliErrorOutput,
  runProcess,
  tailText,
} from "../process.ts";
import type { ProviderRunInput, ProviderRunResult, VisionProvider } from "../types.ts";

function buildCodexPrompt(userPrompt: string | undefined, imagePaths: string[]): string {
  const lines = ["You are an image recognition assistant. Examine the attached image(s) carefully and describe what you see."];
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
    "Attached images:",
    ...imagePaths.map((imagePath, index) => `Image ${index + 1}: ${imagePath}`),
    "",
    "If multiple images are attached, describe each one and how they relate. Answer in the same language as the user's request (default to Chinese when unclear). Return only your description as plain text — no JSON, no markdown code fences.",
  );
  return lines.join("\n");
}

export const codexProvider: VisionProvider = {
  id: "codex",
  label: "Codex CLI",
  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const tempDir = await mkdtemp(join(tmpdir(), "pi-vision-codex-"));
    const resultPath = join(tempDir, "result.txt");
    const timeoutMs = getCodexTimeoutMs();
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--dangerously-bypass-hook-trust",
      "--color",
      "never",
      "--output-last-message",
      resultPath,
      "--cd",
      input.cwd,
    ];
    const detailsArgs = () => args.filter((arg) => arg !== resultPath);
    let stdoutTail = "";
    let stderrTail = "";

    try {
      for (const imagePath of input.imagePaths) {
        args.push("--image", imagePath);
      }
      args.push("-");
      let lastErrorUpdateAt = 0;
      const publishStatus = (message: string, includeOutput = false) => {
        input.onUpdate?.({
          content: [{ type: "text", text: message }],
          details: {
            provider: "codex",
            command: "codex",
            args: detailsArgs(),
            images: input.imagePaths,
            timeoutMs,
            elapsedMs: Date.now() - input.startedAt,
            stdoutTail: includeOutput && stdoutTail ? tailText(stdoutTail, 2_000) : undefined,
            stderrTail: includeOutput && stderrTail ? tailText(stderrTail, 2_000) : undefined,
          },
        });
      };
      publishStatus("Running codex exec for image recognition...");

      const processResult = await runProcess("codex", args, buildCodexPrompt(input.prompt, input.imagePaths), input.cwd, {
        signal: input.signal,
        timeoutMs,
        processLabel: "codex exec",
        env: {
          OPENAI_API_KEY: undefined,
          CODEX_API_KEY: undefined,
        },
        onOutput(stream, chunk, captured) {
          stdoutTail = captured.stdout;
          stderrTail = captured.stderr;
          const now = Date.now();
          if (stream === "stderr" && looksLikeCliErrorOutput(chunk) && now - lastErrorUpdateAt >= ERROR_OUTPUT_UPDATE_THROTTLE_MS) {
            lastErrorUpdateAt = now;
            publishStatus("codex exec reported diagnostic output.", true);
          }
        },
      });
      if (input.signal?.aborted) throw new Error("Codex image recognition was aborted.");
      if (processResult.code !== 0) {
        throw new ProviderExecutionError(`codex exec failed with code ${processResult.code ?? "unknown"}.${processResult.stderr ? `\n${processResult.stderr}` : ""}`, {
          stdout: processResult.stdout,
          stderr: processResult.stderr,
          details: { provider: "codex", command: "codex", args: detailsArgs(), timeoutMs, elapsedMs: Date.now() - input.startedAt },
        });
      }

      const description = (await readFile(resultPath, "utf8").catch(() => "")).trim() || processResult.stdout.trim();
      if (!description) {
        throw new ProviderExecutionError("Codex returned an empty description.", {
          stdout: processResult.stdout,
          stderr: processResult.stderr,
          details: { provider: "codex", command: "codex", args: detailsArgs(), timeoutMs, elapsedMs: Date.now() - input.startedAt },
        });
      }

      input.onUpdate?.({
        content: [{ type: "text", text: "Codex completed image recognition." }],
        details: { provider: "codex", descriptionLength: description.length },
      });

      return {
        provider: "codex",
        description,
        inputImages: input.imagePaths,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        metadata: {
          command: "codex",
          args: detailsArgs(),
          timeoutMs,
          elapsedMs: Date.now() - input.startedAt,
        },
      };
    } catch (error) {
      if (error instanceof ProviderExecutionError) throw error;
      throw new ProviderExecutionError(errorMessageFor(error), {
        stdout: stdoutTail,
        stderr: stderrTail,
        details: { provider: "codex", command: "codex", args: detailsArgs(), timeoutMs, elapsedMs: Date.now() - input.startedAt },
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
};
