import { spawn } from "node:child_process";

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  processLabel?: string;
  env?: NodeJS.ProcessEnv;
  onOutput?: (stream: "stdout" | "stderr", chunk: string, captured: { stdout: string; stderr: string }) => void;
}

export class ProviderExecutionError extends Error {
  stdout?: string;
  stderr?: string;
  details?: Record<string, unknown>;

  constructor(message: string, options?: { stdout?: string; stderr?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = "ProviderExecutionError";
    this.stdout = options?.stdout;
    this.stderr = options?.stderr;
    this.details = options?.details;
  }
}

export const MAX_CAPTURE_CHARS = 50_000;
export const OUTPUT_TAIL_CHARS = 4_000;
export const PROCESS_KILL_GRACE_MS = 5_000;
export const ERROR_OUTPUT_UPDATE_THROTTLE_MS = 5_000;

export function appendTail(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length > MAX_CAPTURE_CHARS ? next.slice(next.length - MAX_CAPTURE_CHARS) : next;
}

export function tailText(text: string, maxChars = OUTPUT_TAIL_CHARS): string {
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

export function formatTimerDuration(ms: number): string {
  if (ms < 60_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  return formatDuration(ms);
}

export function formatGoDuration(ms: number): string {
  return `${Math.max(1, Math.ceil(ms / 1000))}s`;
}

export function formatCapturedOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  const stderrTail = tailText(stderr.trim());
  const stdoutTail = tailText(stdout.trim());
  if (stderrTail) parts.push(`stderr tail:\n${stderrTail}`);
  if (stdoutTail) parts.push(`stdout tail:\n${stdoutTail}`);
  return parts.length > 0 ? `\n\n${parts.join("\n\n")}` : "";
}

export function looksLikeCliErrorOutput(text: string): boolean {
  return /\b(error|failed|failure|servererror|reconnecting|timed out|timeout|aborted|rejected|panic|permission|denied)\b|错误|失败|超时|拒绝|权限/i.test(text);
}

export function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getProviderExecutionOutput(error: unknown): { stdout?: string; stderr?: string; details?: Record<string, unknown> } {
  if (error instanceof ProviderExecutionError) return { stdout: error.stdout, stderr: error.stderr, details: error.details };
  return {};
}

export function runProcess(command: string, args: string[], input: string | undefined, cwd: string, options: RunProcessOptions): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const label = options.processLabel ?? command;
    if (options.signal?.aborted) {
      reject(new Error(`${label} was aborted before it started.`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminationMessage: string | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const useProcessGroup = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd,
      detached: useProcessGroup,
      env: {
        ...process.env,
        CI: process.env.CI ?? "1",
        NO_COLOR: "1",
        TERM: "dumb",
        ...options.env,
      },
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const finishResolve = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(result);
    };

    const killChild = (killSignal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        if (useProcessGroup) {
          process.kill(-child.pid, killSignal);
        } else {
          child.kill(killSignal);
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ESRCH") return;
        try {
          child.kill(killSignal);
        } catch {}
      }
    };

    const terminate = (message: string) => {
      if (settled || terminationMessage) return;
      terminationMessage = message;
      killChild("SIGTERM");
      killTimer = setTimeout(() => {
        killChild("SIGKILL");
        finishReject(new Error(`${message} Forced ${label} to stop after ${formatDuration(PROCESS_KILL_GRACE_MS)}.${formatCapturedOutput(stdout, stderr)}`));
      }, PROCESS_KILL_GRACE_MS);
      killTimer.unref();
    };

    const abort = () => {
      terminate(`${label} was aborted.`);
    };

    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();

    timeoutTimer = setTimeout(() => {
      terminate(`${label} timed out after ${formatDuration(options.timeoutMs)}.`);
    }, options.timeoutMs);
    timeoutTimer.unref();

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = appendTail(stdout, chunk);
      options.onOutput?.("stdout", chunk, { stdout, stderr });
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = appendTail(stderr, chunk);
      options.onOutput?.("stderr", chunk, { stdout, stderr });
    });
    if (child.stdin) {
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") finishReject(new Error(`Failed to write input to ${label}: ${error.message}`));
      });
    }
    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      finishReject(new Error(`Failed to start ${command}: ${message}`));
    });
    child.on("close", (code, childSignal) => {
      if (terminationMessage) {
        finishReject(new Error(`${terminationMessage}${formatCapturedOutput(stdout, stderr)}`));
        return;
      }
      finishResolve({ code, signal: childSignal, stdout, stderr });
    });

    if (child.stdin && input !== undefined) child.stdin.end(input);
  });
}
