/**
 * pi-tps — decode throughput in the footer.
 *
 * The measurement is deepseek-harness's: provider-reported output tokens over the
 * decode wall time only (first output token → settled message), blended over the
 * most recent WINDOW_SIZE settled messages. It is settled-only by design — the
 * figure updates when an assistant message lands and never moves mid-stream, so a
 * displayed value is always a complete window rather than a running guess.
 *
 * State is in-memory: nothing is written to the session, so /tree stays clean and
 * a restarted process starts over.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  formatThroughput,
  isTokenDelta,
  outputTokens,
  pushSample,
  tokensPerSecond,
  type DecodeSample,
} from "./metrics.ts";

/** Footer status key. Point a footer custom item's `statusKey` at it. */
const STATUS_KEY = "tps";

export default function (pi: ExtensionAPI) {
  let samples: DecodeSample[] = [];
  let firstTokenAt: number | null = null;

  function publish(ctx: ExtensionContext): void {
    const value = tokensPerSecond(samples);
    ctx.ui.setStatus(STATUS_KEY, value === undefined ? undefined : formatThroughput(value));
  }

  /** Drop the window and blank the footer slot: the old figure describes work that no longer applies. */
  function reset(ctx: ExtensionContext): void {
    samples = [];
    firstTokenAt = null;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }

  // A restarted, resumed, forked or newly created session is a different
  // conversation than whatever this process was counting.
  pi.on("session_start", (_event, ctx) => {
    reset(ctx);
  });

  // Decode speed is a property of the model; mixing two models' samples makes the
  // figure meaningless. /tree navigation is not a model change and keeps the window.
  pi.on("model_select", (_event, ctx) => {
    reset(ctx);
  });

  pi.on("turn_start", () => {
    firstTokenAt = null;
  });

  pi.on("message_update", (event) => {
    if (firstTokenAt !== null) return;
    if (event.message.role !== "assistant") return;
    if (!isTokenDelta(event.assistantMessageEvent)) return;
    firstTokenAt = Date.now();
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const started = firstTokenAt;
    firstTokenAt = null;
    const { stopReason, usage } = event.message;
    // A cancelled or failed call settles a message here, but it assembled no
    // response; the harness excludes those windows and so does this window.
    if (stopReason === "error" || stopReason === "aborted") return;
    if (started === null) return;
    const tokens = outputTokens(usage);
    if (tokens === undefined) return;
    samples = pushSample(samples, { decodeMs: Math.max(0, Date.now() - started), outputTokens: tokens });
    publish(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    reset(ctx);
  });
}
