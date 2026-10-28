/**
 * Decode-throughput window, ported from deepseek-harness's `turn-metrics` /
 * `sessionStats` projection.
 *
 * Throughput is provider-reported output tokens over the decode wall time alone:
 * first output token → settled message. TTFT, queueing, tool execution and
 * retry waits stay outside the denominator on purpose. The figure is a
 * time-weighted blend over the retained samples, never an average of per-message
 * rates.
 */

import type { AssistantMessageEvent } from "@earendil-works/pi-ai";

/** Samples retained for the figure: the most recent N settled messages. */
export const WINDOW_SIZE = 200;

/** One settled message's decode window and provider-reported output tokens. */
export interface DecodeSample {
  /** First output token → settled message, ms. */
  decodeMs: number
  /** Provider-reported output tokens over that window. */
  outputTokens: number
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Add one sample, dropping the oldest once the window is full.
 * @param samples - the samples retained so far, oldest first.
 * @param sample - one message's decode window and output tokens.
 * @param capacity - samples to retain.
 * @returns a new window; the input is never mutated.
 */
export function pushSample(
  samples: readonly DecodeSample[],
  sample: DecodeSample,
  capacity: number = WINDOW_SIZE,
): DecodeSample[] {
  const next = [...samples, sample];
  return next.length > capacity ? next.slice(next.length - capacity) : next;
}

/**
 * Throughput over the retained samples.
 * @param samples - the window, oldest first.
 * @returns tokens per second, or undefined while the window holds no decode time.
 */
export function tokensPerSecond(samples: readonly DecodeSample[]): number | undefined {
  let decodeMs = 0;
  let outputTokens = 0;
  for (const sample of samples) {
    decodeMs += sample.decodeMs;
    outputTokens += sample.outputTokens;
  }
  if (decodeMs <= 0) return undefined;
  return outputTokens / (decodeMs / 1000);
}

/**
 * Display figure: whole tokens from ten up, one decimal below.
 * @param tps - tokens per second.
 * @returns the number with its unit, e.g. `20 tok/s`.
 */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps);
  const value = clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
  return `${value} tok/s`;
}

const SLOW_ICON = "\u{F0F86}";
const MEDIUM_ICON = "\u{F0F85}";
const FAST_ICON = "\u{F04C5}";

export function throughputIcon(tps: number): string {
  const clamped = Math.max(0, tps);
  if (clamped < 100) return SLOW_ICON;
  if (clamped <= 200) return MEDIUM_ICON;
  return FAST_ICON;
}

export function formatThroughput(tps: number): string {
  return `${throughputIcon(tps)} ${formatTokensPerSecond(tps)}`;
}

/**
 * Whether one stream event carries model-emitted output, i.e. the model has
 * started decoding. Block/usage/finish boundaries do not qualify, and an empty
 * fragment is whitespace-only noise rather than a token. `toolcall_start`
 * counts because a tool call with no argument deltas would otherwise leave a
 * response with no first-token time at all.
 * @param event - one assistant stream event.
 * @returns whether it marks the first output token's arrival.
 */
export function isTokenDelta(event: AssistantMessageEvent): boolean {
  switch (event.type) {
    case "text_delta":
    case "thinking_delta":
    case "toolcall_delta":
      return event.delta !== "";
    case "toolcall_start":
      return true;
    default:
      return false;
  }
}

/**
 * Provider-reported output tokens, guarded so a malformed usage record cannot
 * poison the window with NaN.
 * @param usage - an assistant message's usage record.
 * @returns the output-token count, or undefined when unreported or invalid.
 */
export function outputTokens(usage: unknown): number | undefined {
  if (typeof usage !== "object" || usage === null) return undefined;
  const value = (usage as Record<string, unknown>).output;
  return isCount(value) ? value : undefined;
}
