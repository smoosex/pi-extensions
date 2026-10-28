import { execFileSync, spawn } from "node:child_process";
import type { NotifyConfig } from "./types.ts";

const ESC = "\x1b";
const ST = `${ESC}\\`;

type NotifierDependencies = {
  spawn: typeof spawn;
  readTmuxClientInfo: () => string | undefined;
  generateId: () => string;
};

export function createNotifier(dependencies: Partial<NotifierDependencies> = {}) {
  const spawnCommand = dependencies.spawn ?? spawn;
  const tmuxClientInfo = dependencies.readTmuxClientInfo ?? readTmuxClientInfo;
  const genId = dependencies.generateId ?? (() => `pi-${Date.now()}`);

  return {
    sendNotification(config: NotifyConfig): void {
      try {
        const terminal = detectTerminal(tmuxClientInfo);
        if (terminal === "kitty") notifyKitty(config.title, config.body, genId);
        else if (terminal === "ghostty") notifyGhostty(config.title, config.body);
        else notifyAppleScript(config.title, config.body, spawnCommand);

        runSoundHook(config.soundCommand, spawnCommand);
      } catch {}
    },
  };
}

const defaultNotifier = createNotifier();

export function sendNotification(config: NotifyConfig): void {
  defaultNotifier.sendNotification(config);
}

function detectTerminal(readClientInfo: () => string | undefined): "kitty" | "ghostty" | "other" {
  if (process.env.TMUX) {
    const info = readClientInfo()?.toLowerCase();
    if (info) {
      if (info.includes("kitty")) return "kitty";
      if (info.includes("ghostty")) return "ghostty";
      return "other";
    }
  }

  if (process.env.KITTY_WINDOW_ID) return "kitty";
  if (isGhosttyEnv()) return "ghostty";
  return "other";
}

function isGhosttyEnv(): boolean {
  if (process.env.TERM_PROGRAM?.toLowerCase() === "ghostty") return true;
  if ((process.env.TERM ?? "").toLowerCase().includes("ghostty")) return true;
  return Boolean(process.env.GHOSTTY_RESOURCES_DIR);
}

function readTmuxClientInfo(): string | undefined {
  try {
    return execFileSync("tmux", ["display-message", "-p", "#{client_termname} #{client_termtype}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function notifyKitty(title: string, body: string, genId: () => string): void {
  const safeTitle = Buffer.from(title, "utf8").toString("base64");
  const safeBody = Buffer.from(body, "utf8").toString("base64");
  const id = genId();
  writeSequence(`${ESC}]99;i=${id}:d=0:e=1:o=always;${safeTitle}${ST}`);
  writeSequence(`${ESC}]99;i=${id}:p=body:e=1;${safeBody}${ST}`);
}

function notifyGhostty(title: string, body: string): void {
  writeSequence(`${ESC}]777;notify;${ghosttyField(title).replace(/;/g, " ")};${ghosttyField(body)}\x07`);
}

function ghosttyField(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, " ").trim();
}

function notifyAppleScript(title: string, body: string, spawnCommand: typeof spawn): void {
  const script = `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`;
  spawnCommand("osascript", ["-e", script], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function writeSequence(sequence: string): void {
  process.stdout.write(wrapForTmux(sequence));
}

function wrapForTmux(sequence: string): string {
  if (!process.env.TMUX) return sequence;
  return `${ESC}Ptmux;${sequence.replaceAll(ESC, ESC + ESC)}${ST}`;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"').trim()}"`;
}

function runSoundHook(command: string | undefined, spawnCommand: typeof spawn): void {
  if (!command) return;

  spawnCommand(command, {
    shell: true,
    detached: true,
    stdio: "ignore",
  }).unref();
}
