export function extractMessageText(messages: unknown[] | undefined, role: "user" | "assistant"): string {
  if (!messages) return "";

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isRecord(message) || message.role !== role) continue;

    const text = normalizeMessageText(extractContentText(message.content));
    if (text) return text;
  }

  return "";
}

export function truncateText(text: string, maxLength: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  if (maxLength <= 0) return "";
  if (maxLength === 1) return "…";
  return `${chars.slice(0, maxLength - 1).join("")}…`;
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      return block.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join(" ");
}

function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
