import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extractMessageText, truncateText } from "./messages.ts";
import { parseMessageMax, parseMessageSource } from "./parsers.ts";
import { renderTemplate } from "./template.ts";
import type { NotifyConfig } from "./types.ts";

const DEFAULT_TITLE = "π - {project}";
const DEFAULT_BODY = "{message}";

export function getConfig(ctx?: ExtensionContext, startedAt?: number, messages?: unknown[]): NotifyConfig {
  const durationMs = startedAt ? Date.now() - startedAt : 0;
  const messageMax = parseMessageMax(process.env.PI_NOTIFY_MESSAGE_MAX);
  const userMessage = truncateText(extractMessageText(messages, "user"), messageMax);
  const assistantMessage = truncateText(extractMessageText(messages, "assistant"), messageMax);
  const messageSource = parseMessageSource(process.env.PI_NOTIFY_MESSAGE_SOURCE);
  const message = (messageSource === "assistant" ? assistantMessage : userMessage) || "Ready for input";
  const values = {
    user_message: userMessage,
    assistant_message: assistantMessage,
    message,
  };

  return {
    title: renderTemplate(process.env.PI_NOTIFY_TITLE || DEFAULT_TITLE, ctx, durationMs, values),
    body: renderTemplate(process.env.PI_NOTIFY_BODY || DEFAULT_BODY, ctx, durationMs, values),
    soundCommand: process.env.PI_NOTIFY_SOUND_CMD?.trim() || undefined,
  };
}
