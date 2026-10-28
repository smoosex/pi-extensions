import { mkdir, readFile, writeFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { dirname, join, basename } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_FAMILY = process.env.PI_THEME || "everforest";
const CONTROL_FILE =
	process.env.PI_THEME_CONTROL_FILE || join(homedir(), ".pi", "agent", "pi-theme.json");

type Appearance = "dark" | "light";
type ThemeControl = {
	family?: string;
	appearance?: Appearance;
	theme?: string;
};

function pairedThemeName(family: string, appearance: Appearance): string {
	return `${family}-${appearance}`;
}

function parseAppearance(value: string | undefined): Appearance | undefined {
	const normalized = value?.toLowerCase();
	if (normalized === "dark" || normalized === "light") return normalized;
	return undefined;
}

async function readControlFile(): Promise<ThemeControl | null> {
	try {
		const raw = await readFile(CONTROL_FILE, "utf8");
		const parsed = JSON.parse(raw) as ThemeControl;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

async function writeControlFile(control: ThemeControl) {
	await mkdir(dirname(CONTROL_FILE), { recursive: true });
	await writeFile(CONTROL_FILE, JSON.stringify(control, null, 2) + "\n", "utf8");
}

async function setTheme(ctx: ExtensionContext, themeName: string): Promise<boolean> {
	if (ctx.mode !== "tui") return false;

	if (!ctx.ui.getTheme(themeName)) {
		ctx.ui.notify(`pi-themes: theme not found: ${themeName}`, "warning");
		return false;
	}

	const result = ctx.ui.setTheme(themeName);
	if (!result.success) {
		ctx.ui.notify(`pi-themes: failed to switch theme: ${result.error}`, "error");
		return false;
	}

	ctx.ui.setStatus("pi-themes", ctx.ui.theme.fg("accent", `theme:${themeName}`));
	return true;
}

async function applyControl(ctx: ExtensionContext, currentFamily: string): Promise<string> {
	const control = await readControlFile();
	if (!control) return currentFamily;

	if (typeof control.theme === "string" && control.theme.trim()) {
		await setTheme(ctx, control.theme.trim());
		return currentFamily;
	}

	const family = typeof control.family === "string" && control.family.trim()
		? control.family.trim()
		: currentFamily;
	const appearance = parseAppearance(control.appearance);

	if (appearance) {
		await setTheme(ctx, pairedThemeName(family, appearance));
	}

	return family;
}

export default function (pi: ExtensionAPI) {
	let controlWatcher: FSWatcher | null = null;
	let controlDebounce: ReturnType<typeof setTimeout> | null = null;
	let currentFamily = DEFAULT_FAMILY;

	pi.on("session_start", async (_event, ctx) => {
		await mkdir(dirname(CONTROL_FILE), { recursive: true });
		currentFamily = await applyControl(ctx, currentFamily);

		controlWatcher = watch(dirname(CONTROL_FILE), (eventType, filename) => {
			if (!filename || filename.toString() !== basename(CONTROL_FILE)) return;
			if (eventType !== "change" && eventType !== "rename") return;

			if (controlDebounce) clearTimeout(controlDebounce);
			controlDebounce = setTimeout(() => {
				void applyControl(ctx, currentFamily).then((family) => {
					currentFamily = family;
				});
			}, 50);
		});
	});

	pi.registerCommand("theme", {
		description: "Set theme family, e.g. everforest [dark|light]",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (parts.length === 0) {
				ctx.ui.notify(`Current theme family: ${currentFamily}`, "info");
				return;
			}

			const family = parts[0];
			const appearance = parseAppearance(parts[1]) || "dark";
			const themeName = pairedThemeName(family, appearance);

			currentFamily = family;
			await writeControlFile({ family, appearance });

			const ok = await setTheme(ctx, themeName);
			if (ok) ctx.ui.notify(`Theme set to: ${themeName}`, "info");
		},
	});

	pi.on("session_shutdown", () => {
		if (controlDebounce) {
			clearTimeout(controlDebounce);
			controlDebounce = null;
		}
		if (controlWatcher) {
			controlWatcher.close();
			controlWatcher = null;
		}
	});
}
