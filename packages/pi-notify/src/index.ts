import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getConfig } from "./config.ts";
import { sendNotification } from "./terminal.ts";

export default function piNotify(pi: ExtensionAPI) {
  let startedAt: number | undefined;

  pi.on("agent_start", async () => {
    startedAt = Date.now();
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!ctx.hasUI) return;
    sendNotification(getConfig(ctx, startedAt, event.messages));
    startedAt = undefined;
  });

}
