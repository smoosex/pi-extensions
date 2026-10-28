# pi-vision

A [pi](https://github.com/earendil-works/pi-mono) extension that lets plain-text models "see" images.

When the current model doesn't support image input, it automatically mounts the `image_vision` tool, which delegates image understanding to a local **codex** or **agy** CLI (their models support multimodal input) and returns a textual description to the main model. When you switch back to a multimodal model, the tool disappears — zero token waste, zero accidental calls.

## How it works

The core mechanism is **toggling the tool based on model capabilities**, not relying on prompts to tell the model "don't use it":

- At registration, the tool is always present but not in the active list by default
- On `session_start` and `model_select`, it checks whether `ctx.model.input` contains `"image"`
- Models without image support → add `image_vision` to the active list (so the main model can see and invoke it)
- Models with image support → remove `image_vision` from the active list (the main model reads images directly, no relay needed)

```ts
function syncVisionTool(pi, model) {
  const override = getEffectiveOverride();
  const enable = override === "on" ? true
               : override === "off" ? false
               : !modelSupportsImage(model);   // auto: mount only when images aren't supported
  // incrementally add/remove from the active list without touching the user's other tools
}
```

## Installation

```bash
pi install npm:@smoose/pi-vision
```

Or for local development: drop the repo under `~/.pi/agent/extensions/`, or load it temporarily with `pi -e ./index.ts`.

Requires `codex` or `agy` (at least one) in your PATH.

## Usage

When the main model is a text-only model, it will call the tool automatically:

```
image_vision({ images: ["/tmp/screenshot.png"], prompt: "OCR all the text" })
```

Returns a plain-text description. Multiple images in one call are merged into a single description.

## Commands

| Command | Effect |
|------|------|
| `/vision` | Show current status (enabled or not, whether the model can see images, override, provider) |
| `/vision on` | Force enable (even if the current model supports images) |
| `/vision off` | Force disable |
| `/vision auto` | Restore automatic detection (default) |
| `/vision-provider codex\|agy\|auto` | Switch the vision provider |

The override and provider choice are **persisted globally** to `~/.pi/agent/image-vision.json`, applying across all sessions, restarts, and resumes. Priority: command setting > environment variable > default.

## Configuration (environment variables)

| Variable | Default | Description |
|------|------|------|
| `PI_VISION_PROVIDER` | `codex` | Default provider: `auto` / `codex` / `agy`. `auto` probes the PATH |
| `PI_VISION_CODEX_TIMEOUT_MS` | `600000` | codex execution timeout (10 minutes) |
| `PI_VISION_AGY_TIMEOUT_MS` | `600000` | agy execution timeout |
| `PI_VISION_AGY_MODEL` | - | Model used by agy for image understanding |
| `PI_VISION_MAX_CONCURRENCY` | `5` | Maximum concurrent image recognitions |
| `PI_VISION_FORCE` | `auto` | Force override of automatic detection: `on` / `off` / `auto` |

> Settings in `image-vision.json` override the matching environment variables; delete the file or the corresponding field to fall back to environment variables / defaults.

## Provider invocation

**codex** — `codex exec --output-last-message`, passing `--image`, with a prompt asking it to describe the image; the result file contains the description text.

**agy** — `agy --print`, granting read access to the image's directory via `--add-dir`; stdout is the description text.

Both share the same prompt: by default, a comprehensive description (scene, OCR text, objects, colors, layout); use the `prompt` parameter to focus on a specific aspect. The response language follows the user's request (Chinese by default).
