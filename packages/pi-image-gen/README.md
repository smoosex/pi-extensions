# pi-image-gen

Pi extension that registers `image_gen` and delegates image generation to a local CLI provider: `codex` or `agy`.

`codex` uses `codex exec` with a JSON output schema and validates images under `~/.codex/generated_images/<session-id>/`.

`agy` uses `agy --print` with prompt-constrained JSON output, `--dangerously-skip-permissions`, and validates the returned image path.

## Installation

```sh
pi install npm:@smoose/pi-image-gen
```

## Requirements

- For `codex`: `codex` must be on `PATH`, logged in, and able to use its built-in image generation capability.
- For `agy`: `agy` must be on `PATH` and logged in.

## Tool parameters

- `prompt`: image prompt.
- `images`: optional local image paths.
- `provider`: optional `auto`, `codex`, or `agy`. Defaults to `PI_IMAGE_GEN_PROVIDER` or `codex`.
- `model`: optional provider-specific model. For `agy`, this overrides `PI_AGY_IMAGE_GEN_MODEL`.

## Configuration

The default provider is resolved with this precedence (first match wins):

1. The `provider` argument passed to an individual `image_gen` call.
2. `~/.pi/agent/image-gen.json` (written by `/image-provider`), e.g. `{"provider":"codex"}`.
3. The `PI_IMAGE_GEN_PROVIDER` environment variable.
4. The built-in default `codex`.

```sh
PI_IMAGE_GEN_PROVIDER=codex|agy|auto
PI_CODEX_IMAGE_GEN_TIMEOUT_MS=900000
PI_AGY_IMAGE_GEN_TIMEOUT_MS=900000
PI_IMAGE_GEN_MAX_CONCURRENCY=5
PI_AGY_IMAGE_GEN_MODEL="Gemini 3.5 Flash (High)"
```

If `PI_AGY_IMAGE_GEN_MODEL` is not set and no `model` parameter is passed, `image_gen` does not pass `--model` to `agy`.

`auto` selects an installed provider before execution, preferring `codex` over `agy`; it does not fallback after a provider failure.

Multiple `image_gen` tool calls can run in parallel. `PI_IMAGE_GEN_MAX_CONCURRENCY` limits concurrent provider processes and defaults to `5`.

## Commands

Use `/image-provider` to switch the default provider. The choice is persisted to `~/.pi/agent/image-gen.json`, so it applies to every Pi session on this machine. The footer status shows the active selection.

```text
/image-provider codex
/image-provider agy
/image-provider auto
```

Without an argument, Pi opens a provider picker.

## Timeout

Both providers default to 15 minutes. For `agy`, the timeout is applied both to Pi's outer process guard and to `agy --print-timeout`.

## Failure behavior

When image generation fails, the tool returns the failure reason and terminates the turn. It does not ask Pi to try Python, SVG, Image API scripts, or another provider unless the user explicitly asks for a fallback.

Returned image paths are validated for existence, readability, non-empty content, supported image type, fresh mtime, and not being one of the input images. Codex results are additionally restricted to the current Codex session directory.
