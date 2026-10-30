---
name: image-gen
description: Generate or edit raster images with a local Codex or Antigravity (agy) CLI. Use when the user requests image creation, image editing, or variations using local CLI providers.
compatibility: Requires Node.js 20 or newer, permission to run local processes, and a supported, authenticated CLI with image-generation access and network connectivity.
---

# Image generation

1. Resolve `scripts/image-gen.mjs` relative to this skill directory, not the user's working directory. Run `node <script> probe` and read its JSON result before choosing a provider. If Codex reports `loginError: probe_failed`, its login state is unknown; report the failed check, not a definitive authentication failure. Installation does not prove authentication or image-generation access.
2. If the user explicitly selected Codex or Agy, use that provider only. If it is unavailable, explain the problem and ask before considering an alternative. Otherwise, if both are installed and neither is known to be unauthenticated, ask the user which one to use, unless the user explicitly delegates the choice; in that case, choose a candidate and explain which one you chose. If only one is a candidate, tell the user which one will be used. If neither is usable, stop and explain how to set one up using [provider setup](references/provider-setup.md).
3. If authentication is unknown, say so and check with the user or follow the provider's own login instructions. Never request or inspect credentials. Let the user complete authentication themselves. Local CLIs can send prompts and input images to remote services and may incur charges.
4. Follow [generation workflow](references/generation.md) to pass the prompt and any reference images to the selected provider. Do not weaken the CLI's permissions or sandbox or install software without the user's explicit approval.
5. On success, include the generated image in the response using Markdown image syntax and also report its actual local path as text. Follow the output instructions in [generation workflow](references/generation.md); do not claim the image rendered if the host cannot show it. If generation fails, report the error; do not fabricate an image, silently switch providers, or fall back to an API or another image generator. For errors, consult [troubleshooting](references/troubleshooting.md).
